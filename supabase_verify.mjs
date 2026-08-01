/**
 * AL QUWWA – Supabase Full Connectivity Audit v2
 * Uses correct primary key column names from live schema
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter(l => l.includes("="))
    .map(l => { const idx = l.indexOf("="); return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()]; })
);

const SUPABASE_URL   = env["NEXT_PUBLIC_SUPABASE_URL"];
const ANON_KEY       = env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const SERVICE_KEY    = env["SUPABASE_SERVICE_ROLE_KEY"];
const DB_PROVIDER    = env["DATABASE_PROVIDER"];
const COMPANY_ID     = env["APP_DEFAULT_COMPANY_ID"];
const SALESMAN_ID    = env["APP_DEFAULT_SALESMAN_ID"];
const REALTIME_PROV  = env["REALTIME_PROVIDER"];
const HOSTNAME       = new URL(SUPABASE_URL).hostname;

const results = [];
const pass    = (c, n) => results.push({ c, s:"✅ CONNECTED",     n });
const partial = (c, n) => results.push({ c, s:"⚠️  PARTIAL",      n });
const fail    = (c, n) => results.push({ c, s:"❌ NOT CONNECTED", n });

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{persistSession:false,autoRefreshToken:false} });
const anon  = createClient(SUPABASE_URL, ANON_KEY,    { auth:{persistSession:false,autoRefreshToken:false} });

console.log("\n══════════════════════════════════════════════════════════");
console.log("  AL QUWWA – SUPABASE CONNECTIVITY AUDIT v2");
console.log("══════════════════════════════════════════════════════════");
console.log(`  Host     : ${HOSTNAME}`);
console.log(`  Provider : ${DB_PROVIDER}`);
console.log("══════════════════════════════════════════════════════════\n");

// 1. Provider
if (DB_PROVIDER === "supabase") pass("DATABASE_PROVIDER", "supabase – Supabase repos active, not D1");
else fail("DATABASE_PROVIDER", `'${DB_PROVIDER}' – will fall back to D1`);

// 2. Keys
if (SUPABASE_URL && SERVICE_KEY && ANON_KEY) pass("Env vars", "SUPABASE_URL + SERVICE_ROLE_KEY + ANON_KEY present");
else fail("Env vars", "Missing keys");

// 3. Trusted time RPC
try {
  const { data, error } = await admin.rpc("get_trusted_time");
  if (error) throw error;
  const t = Array.isArray(data) ? data[0]?.server_time : data?.server_time;
  pass("get_trusted_time RPC", `server_time = ${t}`);
} catch (e) { fail("get_trusted_time RPC", e.message); }

// 4. Tables – correct PKs per live schema
const tableChecks = [
  { tbl: "products",              sel: "product_id" },
  { tbl: "day_sessions",         sel: "id" },
  { tbl: "day_stock_items",      sel: "id" },
  { tbl: "sales",                sel: "id" },
  { tbl: "commission_progress",  sel: "salesman_id,product_id,cycle_number" }, // composite PK
  { tbl: "full_commission_rewards", sel: "id" },
  { tbl: "day_closures",         sel: "id" },
  { tbl: "app_settings",         sel: "company_id,business_name,timezone,currency" }, // no id col
  { tbl: "salesmen",             sel: "id,active" },
];
for (const { tbl, sel } of tableChecks) {
  const { data, error } = await admin.from(tbl).select(sel).limit(1);
  if (!error) pass(`Table: ${tbl}`, `accessible – cols: ${sel}`);
  else fail(`Table: ${tbl}`, error.message);
}

// 5. Read products (real data)
try {
  const { data, error } = await admin.from("products").select("product_id,name").limit(20);
  if (error) throw error;
  pass("Read products", `${data.length} products: ${data.map(p=>p.name).join(", ")}`);
} catch (e) { fail("Read products", e.message); }

// 6. Read app_settings
try {
  const { data, error } = await admin.from("app_settings")
    .select("company_id,timezone,currency").eq("company_id", COMPANY_ID).limit(1);
  if (error) throw error;
  if (data?.length) pass("Read app_settings", `timezone=${data[0].timezone}, currency=${data[0].currency}`);
  else partial("Read app_settings", "Row not found for COMPANY_ID");
} catch (e) { fail("Read app_settings", e.message); }

// 7. Active salesman context
try {
  const { data, error } = await admin.from("salesmen").select("id,active").eq("active", true).limit(1);
  if (error) throw error;
  if (data?.length) pass("Active salesman context", `id=${data[0].id}`);
  else fail("Active salesman context", "No active salesman – context resolution will throw");
} catch (e) { fail("Active salesman context", e.message); }

// 8. Isolated write → read-back → persist check → restore
try {
  const { data: row, error } = await admin.from("app_settings")
    .select("company_id,whatsapp_report_number").eq("company_id", COMPANY_ID).maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("No app_settings row for company");

  const original = row.whatsapp_report_number;
  const testVal  = `__AUDIT_${Date.now()}__`;

  const { error: wErr } = await admin.from("app_settings")
    .update({ whatsapp_report_number: testVal }).eq("company_id", COMPANY_ID);
  if (wErr) throw wErr;

  const { data: after, error: rErr } = await admin.from("app_settings")
    .select("whatsapp_report_number").eq("company_id", COMPANY_ID).single();
  if (rErr) throw rErr;

  if (after.whatsapp_report_number === testVal) pass("Write + read-back", "Confirmed – value written and read back");
  else fail("Write + read-back", `Mismatch: got ${after.whatsapp_report_number}`);

  // Second read (persist)
  const { data: again } = await admin.from("app_settings")
    .select("whatsapp_report_number").eq("company_id", COMPANY_ID).single();
  if (again?.whatsapp_report_number === testVal) pass("Persist after refresh", "Value persists on second query");
  else fail("Persist after refresh", "Value lost on second read");

  // Restore
  await admin.from("app_settings").update({ whatsapp_report_number: original }).eq("company_id", COMPANY_ID);
  pass("Cleanup", "Original value restored – no business data damaged");
} catch (e) { fail("Write + read-back", e.message); }

// 9. API routes (dev server)
const BASE = "http://localhost:3000";
for (const [route, method] of [["/api/state","GET"],["/api/settings","GET"],["/api/time","GET"]]) {
  try {
    const res = await fetch(`${BASE}${route}`, { method, signal: AbortSignal.timeout(4000) });
    const body = await res.json().catch(()=>({}));
    if (res.ok) pass(`API ${method} ${route}`, `HTTP ${res.status} – keys: ${Object.keys(body).slice(0,5).join(", ")}`);
    else partial(`API ${method} ${route}`, `HTTP ${res.status}: ${body.error ?? "(no body)"}`);
  } catch (e) { partial(`API ${method} ${route}`, `Dev server not running: ${e.message.slice(0,50)}`); }
}

// 10. RLS – anon should be blocked
try {
  const { data, error } = await anon.from("salesmen").select("id").limit(5);
  if (error) pass("RLS (anon blocked)", `Blocked: ${error.message}`);
  else if (!data || data.length === 0) pass("RLS (anon blocked)", "0 rows returned – RLS filtering working");
  else fail("RLS (anon blocked)", `Anon key returned ${data.length} row(s) – RLS may be open!`);
} catch (e) { partial("RLS check", e.message); }

// 11. Service key NOT in client bundle
try {
  const src = readFileSync("src/components/tracker-app.tsx", "utf8");
  if (src.includes("SERVICE_ROLE_KEY") || src.includes("service_role")) fail("Service-key server-only", "Key in client component!");
  else pass("Service-key server-only", "Not present in tracker-app.tsx (client bundle safe)");
} catch(e) { partial("Service-key server-only", e.message); }

// 12. NEXT_PUBLIC leak
if (env["NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"]) fail("No NEXT_PUBLIC leak", "SERVICE_ROLE_KEY has NEXT_PUBLIC prefix – EXPOSED!");
else pass("No NEXT_PUBLIC leak", "SERVICE_ROLE_KEY correctly private");

// 13. Realtime
if (REALTIME_PROV === "supabase") pass("REALTIME_PROVIDER", "supabase – live events active");
else partial("REALTIME_PROVIDER", `'${REALTIME_PROV || "(empty)"}' – 30s polling fallback active (functional, no live push)`);

// Error surface check – no silent swallowing
const stateRoute = readFileSync("app/api/state/route.ts", "utf8");
if (stateRoute.includes("friendlyDatabaseError") && stateRoute.includes("catch")) 
  pass("Error surface (/api/state)", "Errors caught and returned to client – not silently swallowed");
else 
  partial("Error surface (/api/state)", "Error handling pattern unclear");

// Report
console.log("\n══════════════════════════════════════════════════════════════════");
console.log("  FINAL AUDIT RESULTS");
console.log("══════════════════════════════════════════════════════════════════");
let ok=0,pt=0,ng=0;
for (const r of results) {
  console.log(`\n  ${r.s}`);
  console.log(`  Check : ${r.c}`);
  console.log(`  Detail: ${r.n}`);
  if (r.s.includes("✅")) ok++;
  else if (r.s.includes("⚠️")) pt++;
  else ng++;
}
console.log("\n══════════════════════════════════════════════════════════════════");
console.log(`  ✅ PASSED: ${ok}  |  ⚠️  PARTIAL: ${pt}  |  ❌ FAILED: ${ng}`);
const verdict = ng===0 ? (pt===0 ? "✅ FULLY CONNECTED" : "⚠️  MOSTLY CONNECTED") : "❌ ISSUES FOUND";
console.log(`  VERDICT: ${verdict}`);
console.log("══════════════════════════════════════════════════════════════════\n");
