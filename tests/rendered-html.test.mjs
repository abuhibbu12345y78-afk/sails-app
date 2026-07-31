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
