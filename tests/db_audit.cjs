// Live DB audit: check tables, RPCs, RLS, seed data, and realtime publications
const { createClient } = require(require('path').join(process.cwd(), 'node_modules', '@supabase/supabase-js'));
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync('.env.local', 'utf8');
const getVar = (name) => {
  const line = env.split('\n').find(l => l.trim().startsWith(name + '='));
  return line ? line.split('=').slice(1).join('=').trim() : null;
};

const supabaseUrl = getVar('NEXT_PUBLIC_SUPABASE_URL');
const supabaseServiceKey = getVar('SUPABASE_SERVICE_ROLE_KEY');
const supabaseAnonKey = getVar('NEXT_PUBLIC_SUPABASE_ANON_KEY');

const adminClient = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });
const anonClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });

async function audit() {
  console.log("=== DB AUDIT: TABLE EXISTENCE ===");
  const expectedTables = [
    'tenants', 'companies', 'salesmen', 'products', 'commission_rules',
    'commission_progress', 'sales', 'full_commission_rewards', 'day_closures',
    'app_settings', 'audit_logs', 'day_sessions', 'day_stock_items'
  ];
  for (const table of expectedTables) {
    const { data, error } = await adminClient.from(table).select('count').limit(1);
    if (error) console.log(`  MISSING/ERROR: ${table} => ${error.message}`);
    else console.log(`  EXISTS: ${table}`);
  }

  console.log("\n=== DB AUDIT: SEED DATA ===");
  const { data: tenants } = await adminClient.from('tenants').select('name');
  console.log('  tenants:', JSON.stringify(tenants));
  const { data: products } = await adminClient.from('products').select('name, selling_price_paise').order('sort_order');
  console.log('  products count:', products?.length);
  products?.forEach(p => console.log('   -', p.name, ':', p.selling_price_paise));
  const { data: commProgress } = await adminClient.from('commission_progress').select('id');
  console.log('  commission_progress rows:', commProgress?.length);

  console.log("\n=== DB AUDIT: RPC EXISTENCE ===");
  // Test start_day_session RPC (we know it doesn't exist, checking what does)
  const rpcsToCheck = ['start_day_session', 'close_day_session', 'reopen_day_session',
    'additional_pickup', 'create_sale', 'start_day_atomic', 'create_sale_atomic', 'close_day_atomic'];
  for (const rpc of rpcsToCheck) {
    const { data, error } = await adminClient.rpc(rpc, {});
    if (error && error.code === 'PGRST202') {
      console.log(`  MISSING: ${rpc} (${error.message})`);
    } else if (error && error.message.includes('Could not find')) {
      console.log(`  MISSING: ${rpc}`);
    } else {
      console.log(`  EXISTS or args error: ${rpc} => ${error?.code || 'ok'}`);
    }
  }

  console.log("\n=== DB AUDIT: RLS - ANON ACCESS (should be blocked) ===");
  for (const table of ['tenants', 'companies', 'salesmen', 'products', 'sales', 'day_sessions']) {
    const { data, error } = await anonClient.from(table).select('count').limit(1);
    if (data && data.length > 0 && !error) {
      console.log(`  RISK: ${table} returned data to anon user!`);
    } else {
      console.log(`  BLOCKED: ${table} -> ${error?.message || 'empty result'}`);
    }
  }

  console.log("\n=== DB AUDIT: SETTINGS TABLE (vs migrations) ===");
  const { data: settings, error: settErr } = await adminClient.from('settings').select('*').eq('id', 'default').maybeSingle();
  if (settErr) console.log('  settings table ERROR:', settErr.message, settErr.code);
  else console.log('  settings row:', JSON.stringify(settings));

  const { data: appSettings, error: appErr } = await adminClient.from('app_settings').select('*').limit(1);
  if (appErr) console.log('  app_settings ERROR:', appErr.message);
  else console.log('  app_settings row:', JSON.stringify(appSettings));
}

audit().catch(err => console.error('Audit error:', err.message));
