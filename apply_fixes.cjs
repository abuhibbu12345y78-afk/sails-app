const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync('.env.local', 'utf8');
const getVar = (name) => {
  const line = env.split('\n').find(l => l.trim().startsWith(name + '='));
  return line ? line.split('=').slice(1).join('=').trim() : null;
};

const dbUrl = getVar('SUPABASE_DB_URL');

async function applyFixes() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected to Supabase.");

  try {
    const sql = fs.readFileSync(path.join(__dirname, 'supabase', 'migrations', '20260801000000_audit_fixes.sql'), 'utf8');
    await client.query(sql);
    console.log("Migration 20260801000000_audit_fixes.sql applied successfully.");
  } catch (err) {
    console.error("Migration Error:", err.message);
  } finally {
    await client.end();
  }
}

applyFixes();
