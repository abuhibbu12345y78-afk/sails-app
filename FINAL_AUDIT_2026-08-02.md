# AL QUWWA — PRODUCTION-LEVEL QA, SECURITY & RELEASE READINESS AUDIT

**Audit date:** 2026-08-02 | **Environment:** Local dev (port 3000), local prod build (port 3001), dev Supabase project (ref `krpivlqivokfndlimstm`, aws-0-ap-northeast-1.pooler.supabase.com, PostgreSQL 17.6)
**Method:** Runtime-first. No production code modified, nothing pushed/deployed, no real data mutated. All E2E tests used a throwaway salesman (`AUDIT_E2E_THROWAWAY`, UUID recorded during run, fully deleted in `finally` — verified 0 residue). All financial assertions cross-checked against direct SQL.

**Verdict: NOT READY FOR PRODUCTION** — one P0 (unauthorized RPC execution) and one P1 (test gate red) remain.

---

## 1. Audit Safety & Integrity — VERIFIED
- No `DELETE`/`UPDATE` on real rows; only INSERT of isolated throwaway rows, all removed. Verified `salesmen` count back to 1, `day_expenses` 0, sales count unchanged (6) after all tests.
- No env values printed. No push/deploy. Prod server on 3001 started for measurement and stopped.

## 2. Architecture / Layering — VERIFIED
- No React component touches Supabase directly; UI uses generic `api<T>()` fetch (tracker-app.tsx:34-43). Database access confined to `src/infrastructure/{supabase,d1}/repositories.ts`, chosen by `DATABASE_PROVIDER` (provider.ts:15-34, live=supabase).
- `src/domain/` is pure (commission engine, business-time, day-session state machine) — asserted by tests/rendered-html.test.mjs:43-45.
- Evidence: rendered-html tests 2/3 pass (see §23 for the failing one).

## 3. Environment & Secret Security — PARTIALLY VERIFIED
- `.gitignore:34` covers `.env*`; `git check-ignore .env.local` passes; no tracked `.env` files.
- Bundle scan of 380 `.next` files: no service-role key, no DB password, no anon-JWT ref.
- **P2-1:** `NEXT_PUBLIC_ENABLE_REALTIME` contains a full Supabase anon JWT (not a boolean) in `.env.local`. Inert today (referenced nowhere in code), but it is a public-prefix var containing a credential-shaped value; if it is ever referenced client-side it ships to browsers. Fix: replace with a boolean.
- **P2-2:** Root-level helper scripts untracked (`apply_recent_migrations.cjs`, `translate.js`, `patch-*.mjs`) — not gitignored; some contain lint errors (see §23).
- No `vercel.json`; `package.json` has `engines: {node: ">=22.13.0"}`; Node used is v24.18.0 (satisfies).

## 4. Database / Migration Audit — PARTIALLY VERIFIED (P0 found)
- 15 tables live, matching migrations exactly; RLS enabled on all tables. All columns of the latest migration (`_00700` report format, `_00600` expense description) present — zero drift.
- No `schema_migrations` tracking table exists in the DB — migrations were applied ad hoc (`apply_recent_migrations.cjs`), so **rollback/audit of applied migrations is not possible from the DB**. P2.
- Index inventory: `day_stock_items` has a **duplicate index** `day_stock_session_idx` (non-unique) shadowing the unique `(day_session_id, product_id)` constraint. P3 (write-amplification only).
- No triggers; functions verified SECURITY DEFINER.

## 5. Auth / RLS / Function Security — **FAILED (P0)**
- **P0-1 — anon role can EXECUTE every write RPC.** Live `proacl` shows `anon=X` on all `*_atomic` functions. Migrations only did `revoke ... from public`; Supabase's default grants keep `anon`+`authenticated` execute. The `auth.uid() is not null and not exists(...)` guard is **skipped entirely when uid is NULL**, so anon calls run the full body.
  - Runtime proof: anon key called `create_sale_atomic`, `reset_day_atomic`, `close_day_atomic` → got **domain errors** (`day_not_started`, `day_session_not_found`, `open_day_not_found`) — i.e., function bodies executed; a `permission denied` was never returned.
  - Impact: anyone holding the anon key (present in `.env.local`; a public-prefix var) can forge sales, start/close/reopen/reset days, mark offers received, insert historical data, and wipe days for the real salesman UUID (predictable `00000000-0000-4000-8000-000000000003`).
  - Fix (recommended): in each migration: `revoke execute on function ... from anon, authenticated;` and/or make the guard unconditional (`if (auth.uid() is null or not exists(...)) then raise permission_denied`). Keep grants to `service_role` only (the app uses service role server-side).
- Table-level RLS works for anon: SELECT returns 0 rows (not an error — verified), INSERT into `day_expenses` rejected 401. Only the RPC layer is exposed.

## 6. Core Workflow E2E (isolated throwaway salesman) — VERIFIED (52/54 + P0 caveat)
- start day → 12 normal-only units → 13th unit full-offer-only → qty=13 (12n+1f) → cycle 2 progress reset → reward ₹500 earned cycle 1 → idempotency dedupe (same key, 1 row) → oversell rejected → qty 0 rejected → concurrent oversell rejected (c1 ok, c2 insufficient) → expense +₹300 → negative expense CHECK-rejected → close.
- Exact paise reconciliation: gross 1,150,000 − earnings 165,500 − expenses 30,000 = **net 954,500 — matches RPC output exactly**.
- Remaining = picked − sold (25 − 14 = 11) verified.

## 7. Date Rollover / Trusted Time — VERIFIED
- `/api/time` reports server time + `Asia/Kolkata` business date (2026-08-02 at 16:02 IST).
- Boundary proven: 18:29:59Z→2026-08-02, 18:30:00Z (00:00 IST)→2026-08-03 — rollover at IST midnight, correct.
- `get_trusted_time` RPC is used by all day mutations (server-authoritative); `previous_day_still_open` guard exists in code.

## 8. Stock Integrity — VERIFIED
- Insufficient-stock, product-not-picked, invalid-day-stock guards all exercised; concurrent 2-call race cannot oversell (verified live).

## 9. Commission Rules — VERIFIED
- 9 active rules match seed exactly (ghee-500: n=50 f=500 t=12 … oil: n=15 f=250 t=12); all thresholds 12. Progress persists across cycles; rewards link to sale_id; cycle number and amount-paise correct (₹500 = 50000 paise).

## 10. Offer QA — VERIFIED
- `mark_offer_received_atomic` + `undo_offer_received_atomic` verified; reset blocked with message "Cannot reset a day that contains received offers…" and succeeds after undo; status transitions EARNED→RECEIVED→EARNED persisted.

## 11. Expense QA — VERIFIED
- Insert/update/delete via `/api/expenses` (action-based API); negative amount rejected by CHECK constraint; description column live; expense deduction appears in closure report ("Total Expenses" line) and dashboard trace (expenses=0 currently, matches).

## 12. Day Close / Reopen / Reset — VERIFIED
- Close produces professional report (FM format `₹0.00`, Picked/Sold lines, Total Expenses, Regards — no FM9 artifacts). Closure v1 ACTIVE → reopen (reason `അബദ്ധത്തിൽ ക്ലോസ് ചെയ്തു` persisted in `day_reopens`) → additional pickup (picked 20→25) → re-close v2 with v1 SUPERSEDED. Reset only on OPEN day, blocked with RECEIVED offer, full wipe after undo (sales 0, sessions 0, progress 0). Audit trail rows for started/closed/reopened/reset/additional_pickup all present.

## 13. Day Reset — VERIFIED (see §12; reset wiped all rows, progress rebuilt 0)

## 14. Historical Entry / Reconciliation — VERIFIED
- `npm run test:historical` 1/1 pass — replays historical days on a throwaway salesman, full cleanup verified.
- `historical_data_entry_atomic` (reconciliation engine v2) live; `day_already_exists` guard present.

## 15. Dashboard Audit — VERIFIED
- Dashboard financials traced against direct SQL for today: units 27/27, gross 1,290,000, normal 125,000, full 95,000, earnings 220,000, net 1,070,000, expenses 0 — 7/7 match. Rewards counts match full set (2 earned + 1 received). No phantom/missing rows.

## 16. Filters & Pagination — PARTIALLY VERIFIED (2 minor)
- `/api/state?page&pageSize` returns bounded pages (5 rows / 1 row); date-filtered returns 2; `status`/`product` filters exist in code.
- **P3-1:** non-numeric `page` and malformed dates (`9999-13-45`) are silently ignored → HTTP 200 with empty/clamped data instead of 400. Low severity, no crash, no injection.

## 17. Malayalam Localization Regression — **PARTIALLY VERIFIED (P2)**
- 212 keys in `src/lib/ui-text-ml.ts`, widely used (e.g., `ml.messages.selectTodaysPickedQuantities`, `ml.labels.persistentCommissionProgress`).
- **P2-3:** 35 hardcoded English JSX texts + 117 English string literals remain visible (e.g., "Daily Expenses", "Save Sale", "OPEN NEW DAY", "CONTINUE TO DAY CLOSE", "CONFIRM & START DAY", "Offers Earned", "Gross Sales", bottom-nav labels, filter labels "Offer Status/All Products", error panel). Requirement "no visible unintended English remains" is NOT met.

## 18. Accessibility & Visual — VERIFIED (basics)
- Headless-Chrome sweep at 320/375/430/768/1440: renders at all widths, no horizontal scroll, no console errors/exceptions; html `lang="en"`; no unlabelled buttons/images. Contrast/font-weight enhancements present (commit 1443edc). Full axe-style audit out of scope.

## 19. Button Audit — VERIFIED
- All CTA paths have disabled/loading states (Saving…/Adding…), confirm dialogs (AlertDialog) for destructive actions, secondary-button classes for cancel. No double-submit observed; idempotency keys protect sale retries.

## 20. Realtime QA — PARTIALLY VERIFIED
- Actual behavior: 30s client polling (`tracker-app.tsx:376`) of `/api/state`; no Supabase push channel is used. `src/infrastructure/supabase/realtime.ts` is dead code (0 importers) and `src/infrastructure/realtime/realtime-service.ts` PollingRealtimeService is unused.
- Publication includes 7 tables; `day_expenses` intentionally NOT published (matches code expectation). 30s polling is an accepted fallback per spec, but true realtime is not wired. P3 (as designed/fallback).

## 21. API Quality — VERIFIED (19/21 probes)
- Zod-validated sales route: invalid body/uuid/quantity (0, negative, fractional, huge, SQLi strings) → 400 with friendly message; unknown product → 400/domain; no raw SQL or stack traces ever leaked; SQLi/XSS probes not reflected; duplicate idempotency key consistent (200/201 semantics, 1 row); oversell → domain reject.
- All responses friendly; `x-powered-by` absent; GET endpoints bounded; no write possible via GET.
- Two minor: §16 P3-1 lenient param parsing.

## 22. Performance — PARTIALLY VERIFIED (P2)
- `/api/state` median **3.8s** warm on local prod build (samples 3.0–4.2s); page first-paint ~10s on cold headless (waits on state+time chain). Root cause: ~11 sequential Supabase round-trips (context→settings→salesman→time→sessions→session→5 parallel) at ~300–600ms each (network to ap-northeast-1).
- Initial JS payload 766KB (9 chunks) + 33KB CSS; TTFB 398ms; no inline scripts.
- **P2-4:** Recommend consolidating `getTrackerState` round-trips (single RPC or parallelize context/settings/time) and adding `EXPLAIN`-verified indexes; target <1.5s p95 on deployed region.

## 23. Build & Deployment Gate — **FAILED (P1)**
- `npm run build`: **PASS** (fresh prod build, 16 pages, all dynamic).
- `npm run typecheck`: PASS.
- `npm run test:unit`: **45/45 PASS**; `npm run test:historical`: **1/1 PASS**.
- **P1-1:** `npm test` **FAILS** — `tests/rendered-html.test.mjs:32` asserts literal `Persistent Commission Progress` which commit `cd2292a` (Malayalam conversion) replaced with `ml.labels.persistentCommissionProgress`. Test is stale; gate is red.
- **P1-2:** `npm run lint` **FAILS** — 4 errors: `apply_recent_migrations.cjs` (3× no-require-imports), `translate.js` (1×). Plus 5 warnings in tracker-app.tsx (unused `SaleExpenseEntry`, unused args `reload`/`showToast` at 1090).
- No CI config found in repo (no `.github/workflows`). P3.
- **Verdict effect:** release gate is not green; must be fixed before any deployment claim.

## 24. Responsive / Browser — VERIFIED
- 5 viewports, no horizontal overflow, content + bottom-nav render, Malayalam script renders (font present), no console errors at any width.

## 25. Network Failure / Resilience — PARTIALLY VERIFIED
- Idempotency keys dedupe at 6 layers incl. DB unique constraint (verified live: 1 row per key). Trusted-clock sync + `online`/`visibilitychange` resync exist (test asserts). Friendly offline-ish error strings present. No offline queue / retry for sales beyond idempotency (P3, by design).

## 26. Backup & Recovery — NOT VERIFIED (platform-managed)
- No repo-side backup/restore tooling, docs, or RPO/RTO definitions. Supabase platform backups exist but are not verifiable from the DB; free/Pro-tier PITR availability must be confirmed in the dashboard.
- Recommendation (P2): document RPO/RTO, enable PITR if business data matters, and add a weekly `pg_dump` job outside the platform.

## 27. Severity Register
| ID | Sev | Finding | Fix |
|----|-----|---------|-----|
| P0-1 | **P0** | anon can execute all write RPCs (guard skipped for NULL uid; grants not revoked from anon) | `revoke execute … from anon, authenticated` + unconditional uid guard |
| P1-1 | **P1** | `npm test` red (stale `Persistent Commission Progress` assertion) | update tests/rendered-html.test.mjs |
| P1-2 | **P1** | `npm run lint` red (4 errors in root scripts) | convert to ESM or eslint-ignore root scripts |
| P2-1 | P2 | `NEXT_PUBLIC_ENABLE_REALTIME` holds anon JWT | replace with boolean |
| P2-2 | P2 | untracked root helper scripts; no migration tracking in DB | gitignore/track; adopt `supabase db push` |
| P2-3 | P2 | 35 JSX + 117 literal English strings untranslated | finish `ui-text-ml.ts` migration |
| P2-4 | P2 | `/api/state` 3.8s (11 sequential round-trips) | consolidate queries; re-measure on deploy region |
| P2-5 | P2 | no backup/recovery docs | document RPO/RTO, enable PITR |
| P3-1 | P3 | invalid query params silently accepted (200) | 400 on malformed page/date |
| P3-2 | P3 | duplicate index `day_stock_session_idx` | drop redundant index |
| P3-3 | P3 | realtime = 30s polling only; supabase realtime dead code | wire push or remove dead code |
| P3-4 | P3 | no CI workflow in repo | add CI running `npm test` |

## 28. Final Verdict — **NOT READY FOR PRODUCTION**
- **Not READY** because P0-1 (unauthorized RPC execution — financial data forgeable by anyone with the anon key) and P1-1/P1-2 (release gate red) remain.
- Everything else — core financial engine, idempotency, stock integrity, commission rules, closure math (exact paise), historical reconciliation, dashboard trace, responsive UI, a11y basics, build/typecheck/unit tests — is runtime-verified and strong.
- Recommended path: (1) revoke RPC grants + unconditional uid guard (P0), (2) fix stale test + lint (P1), (3) complete Malayalam pass (P2-3), (4) re-run this audit's scripts (audit-db, api-probes, dash-trace, browser-sweep) → then re-evaluate for **READY FOR CONTROLLED PILOT**.
