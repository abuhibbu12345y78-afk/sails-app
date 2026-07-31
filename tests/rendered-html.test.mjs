import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("replaces the starter with the Commission Compass product", async () => {
  const [page, layout, app, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/tracker-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<TrackerApp \/>/);
  assert.match(layout, /Commission Compass/);
  assert.match(layout, /og\.png/);
  assert.match(app, /Record a Sale/);
  assert.match(app, /Full Commission/);
  assert.match(app, /Day Close/);
  assert.match(app, /Start New Day/);
  assert.match(app, /Previous Day Is Still Open/);
  assert.match(app, /Server time synchronized/);
  assert.match(app, /home-summary-card/);
  assert.match(app, /Persistent Commission Progress/);
  assert.match(app, /Save Sale/);
  assert.match(css, /--primary:/);
  assert.match(css, /\.bottom-nav/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});

test("keeps database calls behind route and infrastructure boundaries", async () => {
  const app = await readFile(new URL("../src/components/tracker-app.tsx", import.meta.url), "utf8");
  const domain = await readFile(new URL("../src/domain/commission.ts", import.meta.url), "utf8");
  assert.doesNotMatch(app, /supabase|cloudflare:workers|D1Database/i);
  assert.doesNotMatch(domain, /fetch\(|supabase|database|D1/i);
  assert.match(domain, /for \(let unit = 0; unit < input\.quantity/);
});

test("keeps trusted time and day actions server-authoritative", async () => {
  const [clock, startRoute, closeRoute, saleRoute] = await Promise.all([
    readFile(new URL("../src/hooks/use-trusted-clock.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/day-start/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/day-close/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sales/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(clock, /visibilitychange/);
  assert.match(clock, /window\.addEventListener\("online"/);
  assert.match(clock, /setInterval\(.*RESYNC_INTERVAL_MS/s);
  assert.doesNotMatch(startRoute, /input\.(startedAt|started_at|businessDate|timestamp)/);
  assert.match(startRoute, /getDatabaseTime/);
  assert.match(closeRoute, /closed_at = CURRENT_TIMESTAMP/);
  assert.match(saleRoute, /remaining_quantity = remaining_quantity -/);
  assert.match(saleRoute, /UPDATE commission_progress/);
  assert.doesNotMatch(closeRoute, /UPDATE commission_progress/);
  assert.doesNotMatch(startRoute, /UPDATE commission_progress/);
});
