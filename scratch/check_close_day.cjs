const fs = require('fs');
const { Client } = require('pg');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((a, l) => {
  const i = l.indexOf('=');
  if (i > 0) a[l.substring(0, i).trim()] = l.substring(i + 1).trim();
  return a;
}, {});

const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
c.connect().then(async () => {
  const r = await c.query(`SELECT prosrc FROM pg_proc WHERE proname='close_day_atomic'`);
  if (r.rows.length > 0) {
    const src = r.rows[0].prosrc;
    console.log('Has v_total_expenses_paise:', src.includes('v_total_expenses_paise'));
    console.log('Has day_expenses query:', src.includes('day_expenses'));
    console.log('Has total_expenses_paise insert:', src.includes('total_expenses_paise'));
  } else {
    console.log('FUNCTION NOT FOUND');
  }
  await c.end();
}).catch(e => { console.error(e.message); process.exit(1); });
