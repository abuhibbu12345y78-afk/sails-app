const fs = require('fs');
const { Client } = require('pg');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((a, l) => {
  const i = l.indexOf('=');
  if (i > 0) a[l.substring(0, i).trim()] = l.substring(i + 1).trim();
  return a;
}, {});

const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
c.connect().then(async () => {
  const sql = fs.readFileSync('supabase/migrations/20260801000600_expense_description.sql', 'utf8');
  await c.query(sql);
  console.log('Migration applied successfully.');
  await c.end();
}).catch(e => { console.error(e.message); process.exit(1); });
