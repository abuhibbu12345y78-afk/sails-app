// Deeper audit: check table columns, relationships, and verify what actually exists vs what repos expect
const { createClient } = require(require('path').join(process.cwd(), 'node_modules', '@supabase/supabase-js'));
const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf8');
const getVar = (name) => {
  const line = env.split('\n').find(l => l.trim().startsWith(name + '='));
  return line ? line.split('=').slice(1).join('=').trim() : null;
};

const adminClient = createClient(getVar('NEXT_PUBLIC_SUPABASE_URL'), getVar('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const anonClient = createClient(getVar('NEXT_PUBLIC_SUPABASE_URL'), getVar('NEXT_PUBLIC_SUPABASE_ANON_KEY'), { auth: { persistSession: false } });

async function deepAudit() {

  console.log("=== AUDIT: Tables the repository expects but may not exist ===");
  const repoTables = ['settings', 'day_close_snapshots', 'day_reopens', 'day_session_sales'];
  for (const table of repoTables) {
    const { data, error } = await adminClient.from(table).select('*').limit(1);
    if (error) console.log(`  MISSING: ${table} => ${error.code}: ${error.message}`);
    else console.log(`  EXISTS: ${table} => ${JSON.stringify(data)}`);
  }

  console.log("\n=== AUDIT: Actual column names in 'sales' table ===");
  const { data: sale1 } = await adminClient.from('sales').select('*').limit(1);
  if (sale1 && sale1.length > 0) {
    console.log('  Columns:', Object.keys(sale1[0]).join(', '));
  } else {
    console.log('  Empty table - checking via information_schema...');
  }

  console.log("\n=== AUDIT: Actual columns in 'app_settings' ===");
  const { data: appSet } = await adminClient.from('app_settings').select('*').limit(1);
  if (appSet && appSet.length > 0) {
    console.log('  Columns:', Object.keys(appSet[0]).join(', '));
    console.log('  Data:', JSON.stringify(appSet[0]));
  }

  console.log("\n=== AUDIT: What columns does 'day_closures' have? ===");
  const { data: dc } = await adminClient.from('day_closures').select('*').limit(1);
  if (dc && dc.length > 0) {
    console.log('  Columns:', Object.keys(dc[0]).join(', '));
  } else {
    console.log('  day_closures is empty - it exists (confirmed earlier)');
  }

  console.log("\n=== AUDIT: RLS test (proper check - count should be 0 for blocked tables) ===");
  for (const table of ['tenants', 'companies', 'salesmen', 'products', 'sales', 'day_sessions']) {
    const { data, error } = await anonClient.from(table).select('id').limit(1);
    if (error) console.log(`  ${table}: ERROR => ${error.code} ${error.message}`);
    else if (!data || data.length === 0) console.log(`  ${table}: BLOCKED (empty result)`);
    else console.log(`  ${table}: EXPOSED - ${data.length} row(s) visible without auth: ${JSON.stringify(data[0]).substring(0, 80)}`);
  }

  console.log("\n=== AUDIT: Does 'settings' table exist in DB? ===");
  const { data: settingsCheck, error: settErr } = await adminClient.from('settings').select('*').limit(1);
  if (settErr) {
    console.log('  settings: NOT FOUND -', settErr.message, settErr.code);
  } else {
    console.log('  settings: EXISTS with', JSON.stringify(settingsCheck));
  }

  console.log("\n=== AUDIT: Products with commission rules (key check) ===");
  const { data: prodRules } = await adminClient.from('commission_rules').select('product_id, normal_commission_paise, full_commission_paise, reward_threshold').is('valid_to', null);
  console.log('  Active commission rules:', prodRules?.length, '(expected 9)');

  console.log("\n=== AUDIT: salesmen table - does it have user_id set? ===");
  const { data: salesmen } = await adminClient.from('salesmen').select('id, display_name, user_id, active');
  salesmen?.forEach(s => console.log(`  ${s.display_name}: user_id=${s.user_id}, active=${s.active}`));

  console.log("\n=== AUDIT: Is 'get_trusted_time' RPC available? ===");
  const { data: timeData, error: timeErr } = await adminClient.rpc('get_trusted_time');
  if (timeErr) console.log('  get_trusted_time: MISSING -', timeErr.message);
  else console.log('  get_trusted_time: EXISTS =>', JSON.stringify(timeData));
}

deepAudit().catch(err => console.error('DEEP AUDIT ERROR:', err.message));
