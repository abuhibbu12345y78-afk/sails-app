import { after, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

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

import { SupabaseProductManagementRepository, SupabaseStateRepository } from '../src/infrastructure/supabase/repositories.ts';
import { createProductManagementUseCases } from '../src/application/product-management.ts';
import { createAdminClient } from '../src/infrastructure/supabase/client.ts';

const PREFIX = `TEST-PM-${Date.now()}`;
const createdIds: string[] = [];

async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    await client.end();
  }
}

function makeInput(name: string, overrides: Partial<Parameters<SupabaseProductManagementRepository['upsertProduct']>[0]> = {}) {
  return {
    name,
    sellingPricePaise: 42000,
    normalCommissionPaise: 2100,
    offerEnabled: true,
    fullCommissionPaise: 42000,
    rewardThreshold: 12,
    active: true,
    sortOrder: 990,
    reason: 'test',
    ...overrides,
  };
}

describe('Product Management Integration Tests', () => {
  it('creates a product, lists it with usage, and surfaces it in the live catalog', async () => {
    process.env.DATABASE_PROVIDER = 'supabase';
    const repo = new SupabaseProductManagementRepository();
    const useCases = createProductManagementUseCases(repo);
    const product = await useCases.upsertProduct(makeInput(`${PREFIX}-A`));
    createdIds.push(product.id);

    assert.ok(product.id);
    assert.match(product.code, /^test-pm-/);

    const list = await useCases.listProducts();
    const found = list.find((item) => item.id === product.id);
    assert.ok(found, 'created product should appear in the management list');
    assert.equal(found.name, `${PREFIX}-A`);
    assert.equal(found.sellingPricePaise, 42000);
    assert.equal(found.normalCommissionPaise, 2100);
    assert.equal(found.active, true);
    assert.equal(found.usage.sales, 0);

    const state = await new SupabaseStateRepository().getTrackerState();
    const catalogProduct = state.products.find((item) => item.id === product.id);
    assert.ok(catalogProduct, 'created product should appear in the runtime catalog');
    assert.equal(catalogProduct.normalCommissionPaise, 2100);
    assert.equal(catalogProduct.offerEnabled, true);
    assert.equal(catalogProduct.fullCommissionPaise, 42000);
    assert.equal(catalogProduct.rewardThreshold, 12);
  });

  it('versions commission rules on financial edits and keeps the catalog current', async () => {
    process.env.DATABASE_PROVIDER = 'supabase';
    const repo = new SupabaseProductManagementRepository();
    const useCases = createProductManagementUseCases(repo);
    const product = await useCases.upsertProduct(makeInput(`${PREFIX}-B`));
    createdIds.push(product.id);

    const updated = await useCases.upsertProduct({
      productId: product.id,
      name: `${PREFIX}-B-renamed`,
      sellingPricePaise: 46000,
      normalCommissionPaise: 2300,
      offerEnabled: true,
      fullCommissionPaise: 46000,
      rewardThreshold: 10,
      active: true,
      sortOrder: 991,
      reason: 'test-edit',
    });

    assert.equal(updated.name, `${PREFIX}-B-renamed`);

    const rules = await query<{ valid_to: string | null; normal_commission_paise: string }>(
      `select valid_to, normal_commission_paise from public.commission_rules where product_id = $1 order by valid_from asc`,
      [product.id]
    );
    assert.equal(rules.length, 2, 'editing commissions must close the old rule and open a new one');
    assert.ok(rules[0].valid_to !== null, 'the original rule must be closed (valid_to set)');
    assert.equal(rules[1].valid_to, null, 'the new rule must be the current one (valid_to null)');
    assert.equal(Number(rules[1].normal_commission_paise), 2300);

    const state = await new SupabaseStateRepository().getTrackerState();
    const catalogProduct = state.products.find((item) => item.id === product.id);
    assert.ok(catalogProduct, 'updated product should still appear in the runtime catalog');
    assert.equal(catalogProduct.sellingPricePaise, 46000);
    assert.equal(catalogProduct.normalCommissionPaise, 2300);
    assert.equal(catalogProduct.rewardThreshold, 10);
  });

  it('disables and re-enables a product for the runtime catalog', async () => {
    process.env.DATABASE_PROVIDER = 'supabase';
    const repo = new SupabaseProductManagementRepository();
    const useCases = createProductManagementUseCases(repo);
    const product = await useCases.upsertProduct(makeInput(`${PREFIX}-C`));
    createdIds.push(product.id);

    await useCases.upsertProduct({
      productId: product.id,
      name: `${PREFIX}-C`,
      sellingPricePaise: 42000,
      normalCommissionPaise: 2100,
      offerEnabled: true,
      fullCommissionPaise: 42000,
      rewardThreshold: 12,
      active: false,
      sortOrder: 990,
      reason: 'test-disable',
    });

    let state = await new SupabaseStateRepository().getTrackerState();
    assert.ok(!state.products.some((item) => item.id === product.id), 'disabled product must leave the runtime catalog');
    const listed = (await useCases.listProducts()).find((item) => item.id === product.id);
    assert.ok(listed && listed.active === false, 'disabled product must remain in the management list as inactive');

    await useCases.upsertProduct({
      productId: product.id,
      name: `${PREFIX}-C`,
      sellingPricePaise: 42000,
      normalCommissionPaise: 2100,
      offerEnabled: true,
      fullCommissionPaise: 42000,
      rewardThreshold: 12,
      active: true,
      sortOrder: 990,
      reason: 'test-enable',
    });

    state = await new SupabaseStateRepository().getTrackerState();
    assert.ok(state.products.some((item) => item.id === product.id), 're-enabled product must re-enter the runtime catalog');
  });

  it('blocks safe-delete while stock records exist, then deletes when unused', async () => {
    process.env.DATABASE_PROVIDER = 'supabase';
    const repo = new SupabaseProductManagementRepository();
    const useCases = createProductManagementUseCases(repo);
    const product = await useCases.upsertProduct(makeInput(`${PREFIX}-D`));
    createdIds.push(product.id);

    const contextRows = await query<{
      tenant_id: string; company_id: string; salesman_id: string;
    }>(
      `select d.tenant_id, d.company_id, d.salesman_id
       from public.day_stock_items d
       where d.sold_quantity >= 0
       limit 1`
    );
    const sessionRows = await query<{ id: string }>(
      `select d.id from public.day_sessions d
       where d.salesman_id = $1 order by d.business_date desc limit 1`,
      [contextRows[0].salesman_id]
    );
    const ctx = contextRows[0];
    const sessionId = sessionRows[0].id;

    await query(
      `insert into public.day_stock_items
        (tenant_id, company_id, salesman_id, day_session_id, product_id, picked_quantity, sold_quantity,
         remaining_quantity, product_name_snapshot, unit_price_paise_snapshot)
       values ($1, $2, $3, $4, $5, 5, 0, 5, $6, 42000)`,
      [ctx.tenant_id, ctx.company_id, ctx.salesman_id, sessionId, product.id, `${PREFIX}-D`]
    );

    try {
      await assert.rejects(
        async () => { await useCases.deleteProduct(product.id, 'test-blocked'); },
        (err: Error) => {
          assert.match(err.message, /in use and cannot be deleted/);
          assert.match(err.message, /1 stock record/);
          return true;
        }
      );

      const afterBlocked = (await useCases.listProducts()).find((item) => item.id === product.id);
      assert.ok(afterBlocked, 'product must survive a blocked delete');
    } finally {
      await query(`delete from public.day_stock_items where product_id = $1`, [product.id]);
    }

    const result = await useCases.deleteProduct(product.id, 'test-cleanup');
    assert.equal(result.deleted, true);
    assert.equal(result.blocked, false);
    assert.ok(!(await useCases.listProducts()).some((item) => item.id === product.id), 'deleted product must leave the management list');

    const audit = await query<{ action: string }>(
      `select action from public.audit_logs where entity_type = 'product' and entity_id = $1 order by created_at desc limit 1`,
      [product.id]
    );
    assert.equal(audit[0]?.action, 'product.deleted', 'safe-delete must write a product.deleted audit record');

    const idx = createdIds.indexOf(product.id);
    if (idx >= 0) createdIds.splice(idx, 1);
  });

  it('keeps product management RPCs out of reach of anon and authenticated roles', async () => {
    const rows = await query<{ proname: string; anon_exec: boolean; auth_exec: boolean }>(
      `select p.proname,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('upsert_product_atomic', 'delete_product_atomic', 'list_product_management_atomic')`
    );
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.anon_exec, false, `${row.proname} must not be executable by anon`);
      assert.equal(row.auth_exec, false, `${row.proname} must not be executable by authenticated`);
    }
  });

  it('writes audit history for product lifecycle actions', async () => {
    process.env.DATABASE_PROVIDER = 'supabase';
    const repo = new SupabaseProductManagementRepository();
    const useCases = createProductManagementUseCases(repo);
    const product = await useCases.upsertProduct(makeInput(`${PREFIX}-E`, { reason: 'created-for-audit' }));
    createdIds.push(product.id);

    const audit = await query<{ action: string; metadata: Record<string, unknown> }>(
      `select action, metadata from public.audit_logs where entity_type = 'product' and entity_id = $1 order by created_at asc`,
      [product.id]
    );
    assert.equal(audit[0]?.action, 'product.created');
    assert.equal(String((audit[0].metadata as { reason?: string }).reason ?? ''), 'created-for-audit');
  });

  it('rejects invalid product input at the use case boundary', async () => {
    process.env.DATABASE_PROVIDER = 'supabase';
    const useCases = createProductManagementUseCases(new SupabaseProductManagementRepository());

    await assert.rejects(
      async () => { await useCases.upsertProduct({ ...makeInput(''), sellingPricePaise: -1 }); },
      (err: Error) => err.message.length > 0
    );
    await assert.rejects(
      async () => { await useCases.upsertProduct(makeInput('Valid Name', { sellingPricePaise: -500 })); },
      (err: Error) => err.message.length > 0
    );
    await assert.rejects(
      async () => { await useCases.upsertProduct(makeInput('Valid Name', { sellingPricePaise: 0 })); },
      (err: Error) => /greater than zero/.test(err.message)
    );
    await assert.rejects(
      async () => { await useCases.upsertProduct(makeInput('Valid Name', { offerEnabled: true, fullCommissionPaise: null })); },
      (err: Error) => /offer/i.test(err.message)
    );
    await assert.rejects(
      async () => { await useCases.upsertProduct(makeInput('Valid Name', { offerEnabled: true, rewardThreshold: null })); },
      (err: Error) => /offer/i.test(err.message)
    );
  });

  it('creates a product without an offer and stores NULL offer fields', async () => {
    process.env.DATABASE_PROVIDER = 'supabase';
    const repo = new SupabaseProductManagementRepository();
    const useCases = createProductManagementUseCases(repo);
    const product = await useCases.upsertProduct(makeInput(`${PREFIX}-NOFFER`, {
      offerEnabled: false,
      fullCommissionPaise: null,
      rewardThreshold: null,
    }));
    createdIds.push(product.id);

    const listed = (await useCases.listProducts()).find((item) => item.id === product.id);
    assert.ok(listed, 'no-offer product should appear in the management list');
    assert.equal(listed.offerEnabled, false);
    assert.equal(listed.fullCommissionPaise, 0);
    assert.equal(listed.rewardThreshold, 0);

    const rules = await query<{ offer_enabled: boolean; full_commission_paise: string | null; reward_threshold: number | null }>(
      `select offer_enabled, full_commission_paise, reward_threshold from public.commission_rules where product_id = $1 and valid_to is null`,
      [product.id]
    );
    assert.equal(rules.length, 1, 'a no-offer product must have exactly one current rule');
    assert.equal(rules[0].offer_enabled, false);
    assert.equal(rules[0].full_commission_paise, null);
    assert.equal(rules[0].reward_threshold, null);

    const state = await new SupabaseStateRepository().getTrackerState();
    const catalogProduct = state.products.find((item) => item.id === product.id);
    assert.ok(catalogProduct, 'no-offer product should appear in the runtime catalog');
    assert.equal(catalogProduct.offerEnabled, false);
    assert.equal(catalogProduct.rewardThreshold, 0);
  });

  it('enables an offer on a no-offer product via rule versioning', async () => {
    process.env.DATABASE_PROVIDER = 'supabase';
    const repo = new SupabaseProductManagementRepository();
    const useCases = createProductManagementUseCases(repo);
    const product = await useCases.upsertProduct(makeInput(`${PREFIX}-NOFFER2`, {
      offerEnabled: false,
      fullCommissionPaise: null,
      rewardThreshold: null,
    }));
    createdIds.push(product.id);

    await useCases.upsertProduct({
      productId: product.id,
      name: `${PREFIX}-NOFFER2`,
      sellingPricePaise: 42000,
      normalCommissionPaise: 2100,
      offerEnabled: true,
      fullCommissionPaise: 42000,
      rewardThreshold: 10,
      active: true,
      sortOrder: 990,
      reason: 'test-enable-offer',
    });

    const rules = await query<{ valid_to: string | null; offer_enabled: boolean; reward_threshold: number | null }>(
      `select valid_to, offer_enabled, reward_threshold from public.commission_rules where product_id = $1 order by valid_from asc`,
      [product.id]
    );
    assert.equal(rules.length, 2, 'enabling an offer must version the rule');
    assert.equal(rules[0].offer_enabled, false);
    assert.ok(rules[0].valid_to !== null, 'the no-offer rule must be closed');
    assert.equal(rules[1].offer_enabled, true);
    assert.equal(rules[1].valid_to, null);
    assert.equal(rules[1].reward_threshold, 10);

    const state = await new SupabaseStateRepository().getTrackerState();
    const catalogProduct = state.products.find((item) => item.id === product.id);
    assert.ok(catalogProduct, 'product with a fresh offer should appear in the catalog');
    assert.equal(catalogProduct.offerEnabled, true);
    assert.equal(catalogProduct.rewardThreshold, 10);
  });

  it('disabling an offer versions the rule and nulls the offer fields', async () => {
    process.env.DATABASE_PROVIDER = 'supabase';
    const repo = new SupabaseProductManagementRepository();
    const useCases = createProductManagementUseCases(repo);
    const product = await useCases.upsertProduct(makeInput(`${PREFIX}-OFFER2`));
    createdIds.push(product.id);

    await useCases.upsertProduct({
      productId: product.id,
      name: `${PREFIX}-OFFER2`,
      sellingPricePaise: 42000,
      normalCommissionPaise: 2100,
      offerEnabled: false,
      fullCommissionPaise: null,
      rewardThreshold: null,
      active: true,
      sortOrder: 990,
      reason: 'test-disable-offer',
    });

    const rules = await query<{ valid_to: string | null; offer_enabled: boolean; full_commission_paise: string | null }>(
      `select valid_to, offer_enabled, full_commission_paise from public.commission_rules where product_id = $1 order by valid_from asc`,
      [product.id]
    );
    assert.equal(rules.length, 2, 'disabling an offer must version the rule');
    assert.equal(rules[0].offer_enabled, true);
    assert.ok(rules[0].valid_to !== null, 'the offer rule must be closed');
    assert.equal(rules[1].offer_enabled, false);
    assert.equal(rules[1].valid_to, null);
    assert.equal(rules[1].full_commission_paise, null);

    const state = await new SupabaseStateRepository().getTrackerState();
    const catalogProduct = state.products.find((item) => item.id === product.id);
    assert.ok(catalogProduct, 'product with a disabled offer should appear in the catalog');
    assert.equal(catalogProduct.offerEnabled, false);
  });

  it('no-offer products earn normal commission only in the live sale engine', async () => {
    process.env.DATABASE_PROVIDER = 'supabase';
    const repo = new SupabaseProductManagementRepository();
    const useCases = createProductManagementUseCases(repo);

    const noOfferProduct = await useCases.upsertProduct(makeInput(`${PREFIX}-ENGINE`, {
      offerEnabled: false,
      fullCommissionPaise: null,
      rewardThreshold: null,
    }));
    createdIds.push(noOfferProduct.id);
    const offerProduct = await useCases.upsertProduct(makeInput(`${PREFIX}-ENGINE2`, {
      fullCommissionPaise: 30000,
      rewardThreshold: 2,
    }));
    createdIds.push(offerProduct.id);

    const ctxRows = await query<{ tenant_id: string; company_id: string }>(
      `select tenant_id, id as company_id from public.companies limit 1`
    );
    const ctx = ctxRows[0];
    const salesmanRows = await query<{ id: string }>(
      `insert into public.salesmen (id, tenant_id, company_id, user_id, display_name, active)
       values (gen_random_uuid(), $1, $2, null, 'TEST-PM-ENGINE-SALESMAN', false)
       returning id`,
      [ctx.tenant_id, ctx.company_id]
    );
    const salesmanId = salesmanRows[0].id;
    const sessionRows = await query<{ id: string }>(
      `insert into public.day_sessions (tenant_id, company_id, salesman_id, business_date, status)
       values ($1, $2, $3, (now() at time zone 'Asia/Kolkata')::date, 'OPEN')
       returning id`,
      [ctx.tenant_id, ctx.company_id, salesmanId]
    );
    const sessionId = sessionRows[0].id;

    const saleIds: string[] = [];
    try {
      for (const [product, quantity] of [[noOfferProduct, 3], [offerProduct, 3]] as const) {
        await query(
          `insert into public.day_stock_items
            (tenant_id, company_id, salesman_id, day_session_id, product_id, picked_quantity, sold_quantity,
             remaining_quantity, product_name_snapshot, unit_price_paise_snapshot)
           values ($1, $2, $3, $4, $5, 10, 0, 10, $6, 42000)`,
          [ctx.tenant_id, ctx.company_id, salesmanId, sessionId, product.id, product.name]
        );
        const saleRows = await query<{ id: string }>(
          `select id from public.create_sale_atomic($1, $2, $3, gen_random_uuid())`,
          [salesmanId, product.id, quantity]
        );
        saleIds.push(saleRows[0].id);
      }

      // No-offer product: all normal, zero snapshots, no progress, no rewards.
      const noOfferSale = await query<{
        normal_commission_units: number; full_commission_units: number;
        reward_threshold_snapshot: number; full_commission_paise_snapshot: number;
      }>(`select normal_commission_units, full_commission_units, reward_threshold_snapshot,
        full_commission_paise_snapshot from public.sales where id = $1`, [saleIds[0]]);
      assert.deepEqual(
        [noOfferSale[0].normal_commission_units, noOfferSale[0].full_commission_units,
          noOfferSale[0].reward_threshold_snapshot, noOfferSale[0].full_commission_paise_snapshot],
        [3, 0, 0, 0],
        'a no-offer sale must be 100% normal commission with zero snapshots'
      );
      const noOfferProgress = await query(
        `select 1 from public.commission_progress where salesman_id = $1 and product_id = $2`,
        [salesmanId, noOfferProduct.id]
      );
      assert.equal(noOfferProgress.length, 0, 'no-offer sales must never create commission progress');
      const noOfferRewards = await query(
        `select 1 from public.full_commission_rewards where salesman_id = $1 and product_id = $2`,
        [salesmanId, noOfferProduct.id]
      );
      assert.equal(noOfferRewards.length, 0, 'no-offer sales must never create offer rewards');

      // Offer product control: threshold 2, quantity 3 -> 2 normal + 1 full, progress and reward created.
      const offerSale = await query<{ full_commission_units: number; reward_threshold_snapshot: number }>(
        `select full_commission_units, reward_threshold_snapshot from public.sales where id = $1`, [saleIds[1]]
      );
      assert.equal(offerSale[0].full_commission_units, 1, 'the offer control must still award full commission');
      assert.equal(offerSale[0].reward_threshold_snapshot, 2);
      const offerProgress = await query<{ normal_sales_completed: number; cycle_number: number }>(
        `select normal_sales_completed, cycle_number from public.commission_progress
         where salesman_id = $1 and product_id = $2`, [salesmanId, offerProduct.id]
      );
      assert.equal(offerProgress.length, 1, 'offer sales must create commission progress');
      assert.deepEqual([offerProgress[0].normal_sales_completed, offerProgress[0].cycle_number], [0, 2]);
      const offerRewards = await query<{ cycle_number: number }>(
        `select cycle_number from public.full_commission_rewards where salesman_id = $1 and product_id = $2`,
        [salesmanId, offerProduct.id]
      );
      assert.equal(offerRewards.length, 1, 'offer sales must create one earned reward');
      assert.equal(offerRewards[0].cycle_number, 1);

      // Reverse one unit of the no-offer sale: still all normal, still no progress/rewards.
      await query(
        `select public.reverse_sale_atomic($1, $2, 1, 'test-return', gen_random_uuid())`,
        [salesmanId, saleIds[0]]
      );
      const reversed = await query<{ normal_commission_units: number }>(
        `select normal_commission_units from public.sales where id = $1`, [saleIds[0]]
      );
      assert.equal(reversed[0].normal_commission_units, 2, 'returning a no-offer unit keeps the sale all normal');
      const noOfferProgressAfter = await query(
        `select 1 from public.commission_progress where salesman_id = $1 and product_id = $2`,
        [salesmanId, noOfferProduct.id]
      );
      assert.equal(noOfferProgressAfter.length, 0, 'returns on no-offer products must not create progress');
    } finally {
      await query(`delete from public.sale_returns where salesman_id = $1`, [salesmanId]);
      await query(`delete from public.full_commission_rewards where salesman_id = $1`, [salesmanId]);
      await query(`delete from public.sales where salesman_id = $1`, [salesmanId]);
      await query(`delete from public.day_stock_items where salesman_id = $1`, [salesmanId]);
      await query(`delete from public.day_sessions where salesman_id = $1`, [salesmanId]);
      await query(`delete from public.commission_progress where salesman_id = $1`, [salesmanId]);
      await query(`delete from public.audit_logs
        where (entity_type = 'sale' and entity_id = any($1::uuid[]))
           or (entity_type = 'product' and entity_id in ($2::uuid, $3::uuid))`,
        [saleIds, noOfferProduct.id, offerProduct.id]);
      await query(`delete from public.salesmen where id = $1`, [salesmanId]);
      await query(`delete from public.commission_rules where product_id in ($1, $2)`,
        [noOfferProduct.id, offerProduct.id]);
      await query(`delete from public.products where id in ($1, $2)`,
        [noOfferProduct.id, offerProduct.id]);
    }
  });
});

after(async () => {
  // Best-effort cleanup of throwaway products (no references should exist).
  for (const id of [...createdIds].reverse()) {
    try {
      const supabase = createAdminClient();
      await supabase.rpc('delete_product_atomic', { p_product_id: id, p_reason: 'test-cleanup' });
    } catch {
      // Ignore cleanup failures; report residue via the test output instead.
    }
  }
});
