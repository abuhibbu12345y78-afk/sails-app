const fs = require('fs');
const { Client } = require('pg');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((a, l) => {
  const i = l.indexOf('=');
  if (i > 0) a[l.substring(0, i).trim()] = l.substring(i + 1).trim();
  return a;
}, {});

const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
c.connect().then(async () => {
  // Check reset_day_atomic
  const r = await c.query(`SELECT 1 FROM pg_proc WHERE proname=$1`, ['reset_day_atomic']);
  console.log('reset_day_atomic:', r.rows.length > 0 ? 'EXISTS' : 'MISSING');

  // day_expenses columns
  const d = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='day_expenses' ORDER BY ordinal_position`);
  console.log('day_expenses columns:', d.rows.map(r => r.column_name).join(', '));

  // day_closures columns
  const e = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='day_closures' ORDER BY ordinal_position`);
  console.log('day_closures columns:', e.rows.map(r => r.column_name).join(', '));

  // Check if day_expenses has description column
  const descCheck = await c.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='day_expenses' AND column_name='description'`);
  console.log('day_expenses.description column:', descCheck.rows.length > 0 ? 'EXISTS' : 'MISSING');

  // Check existing expense data
  const expCount = await c.query(`SELECT count(*) FROM public.day_expenses`);
  console.log('Existing expense records:', expCount.rows[0].count);

  await c.end();
}).catch(e => { console.error(e.message); process.exit(1); });
