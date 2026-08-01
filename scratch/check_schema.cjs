const fs = require('fs');
const { Client } = require('pg');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const idx = line.indexOf('=');
  if (idx > 0) acc[line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
  return acc;
}, {});

const client = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();

  const funcs = [
    'create_sale_atomic', 'mark_offer_received_atomic', 'undo_offer_received_atomic',
    'close_day_atomic', 'reopen_day_atomic', 'start_day_atomic',
    'historical_data_entry_atomic', 'get_trusted_time'
  ];
  console.log('\n=== FUNCTIONS ===');
  for (const f of funcs) {
    const r = await client.query(`SELECT 1 FROM pg_proc WHERE proname = $1`, [f]);
    console.log(f, r.rows.length > 0 ? '✅ EXISTS' : '❌ MISSING');
  }

  const tables = [
    'tenants', 'companies', 'salesmen', 'products', 'commission_rules',
    'commission_progress', 'day_sessions', 'day_stock_items', 'sales',
    'full_commission_rewards', 'day_closures', 'day_reopens',
    'app_settings', 'audit_logs', 'day_expenses'
  ];
  console.log('\n=== TABLES ===');
  for (const t of tables) {
    const r = await client.query(`SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=$1`, [t]);
    console.log(t, r.rows.length > 0 ? '✅ EXISTS' : '❌ MISSING');
  }

  const migrationFiles = fs.readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort();
  console.log('\n=== MIGRATION FILES ===');
  for (const mf of migrationFiles) {
    console.log(mf);
  }

  await client.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });
