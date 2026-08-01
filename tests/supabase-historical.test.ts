import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

// Load .env.local if present
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf8');
    for (const line of envFile.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...vals] = trimmed.split('=');
        if (key && !process.env[key.trim()]) {
          process.env[key.trim()] = vals.join('=').trim();
        }
      }
    }
  }
} catch {
  // Ignore env loading errors
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DB_URL = process.env.SUPABASE_DB_URL!;

// Throwaway dates (must not collide with real data; verified absent as of 2026-08-01)
const D1 = '2024-02-05'; // 12 units -> progress 12
const D2 = '2024-02-06'; // inserted LAST -> expected received_offer_conflict
const D3 = '2024-02-07'; // 5 units -> creates the offer

describe('Supabase Historical Reconciliation (isolated, non-destructive)', () => {
  it('replays historical days on a throwaway salesman and fully cleans up', async () => {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const pg = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await pg.connect();

    let throwawaySalesmanId: string | null = null;
    const failures: string[] = [];
    const check = (label: string, ok: boolean, detail = '') => {
      if (!ok) failures.push(`${label}${detail ? ` (${detail})` : ''}`);
    };

    try {
      // ---- Setup: throwaway salesman in the REAL company (isolated progress) ----
      const { data: realSalesman } = await supabase.from('salesmen').select('id, company_id, tenant_id').eq('active', true).limit(1).single();
      assert.ok(realSalesman, 'No active salesman found');

      const { data: ghee } = await supabase.from('products').select('id').eq('company_id', realSalesman.company_id).eq('active', true).ilike('name', '%Ghee%').limit(1).single();
      assert.ok(ghee, 'No Ghee product found');

      const ins = await pg.query(
        `insert into public.salesmen (tenant_id, company_id, user_id, display_name, active)
         values ($1, $2, null, 'ISOLATED_HISTORICAL_TEST', true) returning id`,
        [realSalesman.tenant_id, realSalesman.company_id]
      );
      throwawaySalesmanId = ins.rows[0].id;

      const pickup = [{ product_id: ghee.id, picked_quantity: 20 }];
      const call = (date: string, qty: number) => supabase.rpc('historical_data_entry_atomic', {
        p_salesman_id: throwawaySalesmanId!,
        p_business_date: date,
        p_pickup_items: pickup,
        p_sales_items: [{ product_id: ghee.id, quantity: qty }],
      });

      // ---- Step 1: insert D1 (12 units) ----
      let res = await call(D1, 12);
      check('D1 inserted', !res.error, res.error?.message);
      if (!res.error) {
        const prog = await pg.query(`select normal_sales_completed, cycle_number from public.commission_progress where salesman_id=$1 and product_id=$2`, [throwawaySalesmanId, ghee.id]);
        check('progress = 12 / cycle 1', Number(prog.rows[0]?.normal_sales_completed) === 12 && Number(prog.rows[0]?.cycle_number) === 1, JSON.stringify(prog.rows[0]));
        const closure = await pg.query(`select total_units from public.day_closures where salesman_id=$1 and business_date=$2`, [throwawaySalesmanId, D1]);
        check('closure created for D1 (12 units)', closure.rows[0]?.total_units === 12);
      }

      // ---- Step 2: insert D3 (5 units) -> creates offer ----
      res = await call(D3, 5);
      check('D3 inserted', !res.error, res.error?.message);
      if (!res.error) {
        const prog = await pg.query(`select normal_sales_completed, cycle_number from public.commission_progress where salesman_id=$1 and product_id=$2`, [throwawaySalesmanId, ghee.id]);
        check('progress rebuilt = 4 / cycle 2', Number(prog.rows[0]?.normal_sales_completed) === 4 && Number(prog.rows[0]?.cycle_number) === 2, JSON.stringify(prog.rows[0]));

        const sale = await pg.query(`
          select s.normal_commission_units, s.full_commission_units, s.total_earnings_paise
          from public.sales s join public.day_sessions d on d.id = s.day_session_id
          where s.salesman_id=$1 and d.business_date=$2`, [throwawaySalesmanId, D3]);
        check('D3 sale = 4 normal + 1 full', Number(sale.rows[0]?.normal_commission_units) === 4 && Number(sale.rows[0]?.full_commission_units) === 1, JSON.stringify(sale.rows[0]));

        const rewards = await pg.query(`select id, cycle_number, status from public.full_commission_rewards where salesman_id=$1 and product_id=$2`, [throwawaySalesmanId, ghee.id]);
        check('1 EARNED reward (cycle 1)', rewards.rows.length === 1 && rewards.rows[0].status === 'earned' && Number(rewards.rows[0].cycle_number) === 1, JSON.stringify(rewards.rows));

        // ---- Step 3: mark received ----
        const rewardId = rewards.rows[0].id;
        res = await supabase.rpc('mark_offer_received_atomic', { p_salesman_id: throwawaySalesmanId, p_reward_id: rewardId });
        check('mark_offer_received_atomic OK', !res.error && res.data?.status === 'received', res.error?.message);
      }

      // ---- Step 4: insert D2 (between D1 and D3) -> MUST conflict ----
      res = await call(D2, 5);
      check('received_offer_conflict raised', !!res.error && (res.error.message || '').includes('received_offer_conflict'), res.error?.message || 'NO ERROR');
    } finally {
      // ---- Cleanup (always runs) ----
      if (throwawaySalesmanId) {
        const sessionIds = (await pg.query(`select id from public.day_sessions where salesman_id=$1`, [throwawaySalesmanId])).rows.map((r: { id: string }) => r.id);
        if (sessionIds.length) {
          await pg.query(`delete from public.audit_logs where entity_id = any($1::uuid[])`, [sessionIds]);
        }
        await pg.query(`delete from public.full_commission_rewards where salesman_id=$1`, [throwawaySalesmanId]);
        await pg.query(`delete from public.sales where salesman_id=$1`, [throwawaySalesmanId]);
        await pg.query(`delete from public.day_closures where salesman_id=$1`, [throwawaySalesmanId]);
        await pg.query(`delete from public.day_stock_items where salesman_id=$1`, [throwawaySalesmanId]);
        await pg.query(`delete from public.day_sessions where salesman_id=$1`, [throwawaySalesmanId]);
        await pg.query(`delete from public.commission_progress where salesman_id=$1`, [throwawaySalesmanId]);
        await pg.query(`delete from public.salesmen where id=$1`, [throwawaySalesmanId]);
      }
      await pg.end();
    }

    assert.equal(failures.length, 0, failures.join('\n'));
  });
});
