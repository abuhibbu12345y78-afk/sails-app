const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(process.cwd(), 'node_modules', 'pg'));

const correctUrl = 'postgresql://postgres.krpivlqivokfndlimstm:m1o2n3u4907273@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres';

async function runRecentMigrations() {
  console.log("Connecting to PostgreSQL...");
  const client = new Client({ connectionString: correctUrl, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    console.log("🎉 CONNECTED SUCCESSFULLY TO SUPABASE POSTGRESQL!");

    const migrations = [
      '20260801000000_audit_fixes.sql',
      '20260801000100_historical_entry.sql',
      '20260801000200_historical_reconciliation.sql',
      '20260801000300_day_expenses.sql',
      '20260801000400_offer_undo.sql',
      '20260801000500_atomic_day_reset.sql',
      '20260801000600_expense_description.sql',
      '20260801000700_report_format.sql'
    ];

    for (const file of migrations) {
      console.log(`Applying ${file}...`);
      const p = path.join(process.cwd(), 'supabase', 'migrations', file);
      const tempClient = new Client({ connectionString: correctUrl, ssl: { rejectUnauthorized: false } });
      try {
        await tempClient.connect();
        await tempClient.query(fs.readFileSync(p, 'utf8'));
        console.log(`✓ ${file} applied!`);
      } catch (e) {
        console.error(`Error applying ${file}:`, e.message);
      } finally {
        await tempClient.end();
      }
    }

    console.log("Done.");
  } catch (err) {
    console.error("Connection Error:", err.message);
    if (client) await client.end();
  }
}

runRecentMigrations();
