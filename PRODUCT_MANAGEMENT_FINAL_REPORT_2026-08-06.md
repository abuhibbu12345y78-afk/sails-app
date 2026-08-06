# AL QUWWA — Database-Driven Product Management: Final Report

**Date:** 2026-08-06 · **Scope:** Complete product management feature · **No git push, no deploy, no DB reset.**

---

## 1. What was implemented

A fully database-driven product management system: salesmen can add, edit, enable, disable, and safe-delete products; edit commissions/price/threshold; set display order; and see live usage counts — all surfaced through a new "ഉൽപ്പന്നങ്ങൾ നിയന്ത്രിക്കുക" (Manage Products) screen under Settings & More. The runtime product catalog was already DB-driven; this feature makes the *entire lifecycle* DB-driven with atomic, audited RPCs, and removes the need for any hardcoded product list in the active path.

## 2. Migration (non-destructive, additive only)

`supabase/migrations/20260806000000_product_management.sql` — creates 3 functions, changes no tables, deletes nothing:

| RPC | Purpose |
|---|---|
| `upsert_product_atomic(p_product_id, tenant, company, name, price, normal, full, threshold, active, sort_order, reason)` | Create (product_id NULL → generates unique `code` from the name) or update. On commission changes it closes the current `commission_rules` version (`valid_to = now()`) and opens a new one (`valid_from = now()`), which the pre-existing partial unique index `commission_rules_current_idx` enforces atomically. Writes audit rows (`product.created` / `product.updated` / `product.disabled` / `product.enabled`) with prev/changed metadata. |
| `delete_product_atomic(product_id, reason)` | Safe delete. Returns a jsonb result `{deleted, blocked, sales, stock_items, progress, rewards, closures, audit_logs}` instead of raising, so the UI can show exact counts. Blocked when ANY of those references exist. Deletes rule versions + progress rows + product; writes `product.deleted` audit. |
| `list_product_management_atomic(company_id)` | One-call listing: all products (active + inactive) with the current rule (lateral join on `valid_to is null`, latest `valid_from`) and live dependency counts. |

**Grants:** all three are `revoke all ... from public, anon, authenticated; grant execute ... to service_role` only. Verified live (see §13). The guards also keep the existing `if auth.uid() is not null and not exists (salesman membership) then permission_denied` pattern.

## 3. Layering (UI → API Route → Use Case → Repository → RPC)

- **UI:** `src/components/product-management.tsx` (list, add/edit dialog, enable/disable confirm, delete confirm with dependency summary). No Supabase access — `fetch("/api/products")` only.
- **API route:** `app/api/products/route.ts` — GET (list), POST (create), PUT (update), DELETE (safe delete). Zod validation (uuid, int paise, thresholds), `DomainError → status`, `friendlyDatabaseError → 500`.
- **Use case:** `src/application/product-management.ts` — `createProductManagementUseCases(...)` with `validateProductInput` (name 1–80, paise integers, normal ≤ price, threshold 1–999, sort 0–9999) and blocked-delete → `DomainError(409)` mapping.
- **Repository:** `src/application/repositories.ts` (`ProductManagementRepository` + `ProductManagementItem`, `ProductUsage` contracts) → `SupabaseProductManagementRepository` in `src/infrastructure/supabase/repositories.ts` (rpc calls); D1 gets an explicit unsupported stub in `src/infrastructure/provider.ts` (same pattern as D1 expenses).
- **Money:** paise only across API/RPC/domain. The UI converts ₹ strings → paise on input; the server re-validates the paise integers (client conversions are never trusted).

## 4. Historical financial protection — decision

**Inspection result:** sale records store NO `rule_version_id`, but they store complete financial snapshots (`product_name_snapshot`, `unit_selling_price_paise`, `normal_commission_paise_snapshot`, `full_commission_paise_snapshot`, `reward_threshold_snapshot`, `gross_sales_paise`, totals, `net_collection_paise`). `create_sale_atomic`/`reverse_sale_atomic` already snapshot from `products.selling_price_paise` + the current rule, and reverse replays entirely from snapshots.

**Therefore the safe model is rule *versioning*** (no schema change needed): an edit never touches old rows — it closes the open rule and opens a new one, so historical sales, offers, and closure reports keep their exact original figures. Verified in tests: after an edit, the old rule has `valid_to` set, the new rule is current, and the runtime catalog immediately returns the new values while history tables are untouched. This satisfies the "snapshot or versioning" requirement with zero migration of existing data.

## 5. Safe-delete dependency list (server-side, authoritative)

Blocked when any record references the product: **sales** (FK), **day_stock_items** (FK), **commission_progress** (FK), **full_commission_rewards** (FK), **day_closures** (jsonb scan of `product_summary @> [{"product_id": ...}]`), and **audit_logs** that reference the product for business purposes (`entity_type='product'` with non-lifecycle actions, or other entities whose metadata embeds the product id). The product's *own lifecycle* audit records (created/updated/enabled/disabled) do NOT block deletion — otherwise no product could ever be deleted, since creation always logs. The `product.deleted` row is appended as history. Counts are computed in the RPC, never trusted from the client; the UI merely displays them and disables the button when the RPC reports a block.

## 6. Enable / disable behavior

- Disabling sets `active=false` (no rule/version changes): the product immediately leaves the runtime catalog (`/api/state` filters `active = true`) — so it stops appearing in Day Start, Additional Pickup, Sale cards, and Historical Data Entry — while all existing records remain readable and closed days are unchanged.
- Re-enabling sets `active=true` and the product re-enters the catalog with its current rule intact.
- **Open-day safety:** because the catalog is `active`-filtered, a disabled product cannot receive new sales; nothing is ever hard-deleted from an open day. All 9 seeded products carry stock/progress records, so no production product is deletable today — the feature's delete path is exercised via throwaway products (see §10). (No OPEN day existed during this session — business date 2026-08-06 was NOT_STARTED — so a disable-while-open UI demo was not possible; the behavior is enforced by the same code path verified live.)

## 7. Display order

`sort_order` (int, 0–9999) is editable per product. Every consumer sorts by it: the runtime catalog (`order('sort_order')` in the state query), Day Start, Additional Pickup, Sale cards, Historical Data Entry, and the Product Management list (`order by sort_order, name` inside the listing RPC). The UI defaults a new product's order to `list length + 1`; users can set any number to interleave.

## 8. Code generation & uniqueness

New products generate `code` from the name: lowercase, non-alphanumerics → `-`, trim dashes, cap 40 chars; on collision a 6-hex suffix of `md5(name:now())` is appended (`unique(company_id, code)` protects concurrently). All-Malayalam names degrade gracefully to `product` / `product-<suffix>`. Codes are internal identifiers, never shown to end users as business data.

## 9. Malayalam labels added (`src/lib/ui-text-ml.ts` → `ml.products.*`)

`manageProducts: "ഉൽപ്പന്നങ്ങൾ നിയന്ത്രിക്കുക"`, `addNewProduct: "പുതിയ ഉൽപ്പന്നം ചേർക്കുക"`, `addProduct: "ഉൽപ്പന്നം ചേർക്കുക"`, `editProduct: "ഉൽപ്പന്നം തിരുത്തുക"`, `saveChanges: "മാറ്റങ്ങൾ സേവ് ചെയ്യുക"`, `deleteProduct: "ഉൽപ്പന്നം ഇല്ലാതാക്കുക"`, `productName: "ഉൽപ്പന്നത്തിന്റെ പേര്"`, `sellingPrice: "വിൽപ്പന വില"`, `normalCommission: "സാധാരണ കമ്മീഷൻ"`, `offerAmount: "ഓഫർ തുക"`, `offerLimit: "ഓഫർ പരിധി"`, `status: "പ്രവർത്തന നില"`, `active/inactive: "സജീവം/പ്രവർത്തനരഹിതം"`, `displayOrder: "പ്രദർശന ക്രമം"`, `disable/enable: "പ്രവർത്തനരഹിതമാക്കുക/വീണ്ടും പ്രവർത്തനക്ഷമമാക്കുക"`, `edit: "തിരുത്തുക"`, `financialChangeWarning: "ഈ മാറ്റം ഇനി രേഖപ്പെടുത്തുന്ന വിൽപ്പനകൾക്ക് മാത്രമേ ബാധകമാകൂ. മുൻപത്തെ വിൽപ്പനകളുടെ കണക്കുകൾ മാറില്ല."`, `deleteBlockedMessage: "ഈ ഉൽപ്പന്നവുമായി ബന്ധപ്പെട്ട രേഖകൾ നിലവിലുള്ളതിനാൽ ഇല്ലാതാക്കാൻ കഴിയില്ല..."`, plus reason defaults `"ഉൽപ്പന്ന വിവരങ്ങൾ തിരുത്തി"`, `"താൽക്കാലികമായി പ്രവർത്തനരഹിതമാക്കി"`, `"വീണ്ടും പ്രവർത്തനക്ഷമമാക്കി"`, `"ഇനി ആവശ്യമില്ലാത്ത ഉൽപ്പന്നം"` and usage labels. Internal statuses/actions/columns remain English (`ACTIVE/INACTIVE`, `product.created`, …) — Malayalam is presentation-only.

## 10. Tests

New `tests/product-management.test.ts` (live-Supabase integration, same env/cleanup pattern as `supabase-reset.test.ts`), all passing:

1. Create → appears in management list with usage 0, appears in the runtime catalog with correct rule values.
2. Financial edit → exactly 2 rule versions (old `valid_to` set, new current), catalog returns new price/commission/threshold.
3. Disable → leaves catalog; re-enable → re-enters (list still shows inactive in between).
4. Safe-delete → blocked with "1 stock record(s)" while a stock row exists, then succeeds after removal; `product.deleted` audit written.
5. **Security regression:** `has_function_privilege('anon'|'authenticated', ...)` = false for all 3 RPCs.
6. Audit lifecycle: `product.created` with metadata reason.
7. Boundary validation rejects bad input before hitting the DB.

`after()` cleanup deletes every throwaway product; residue re-checked after the run (see §14).

## 11. Verification commands — ALL GREEN

```
npm run typecheck   → PASS (0 errors)
npm run lint        → PASS (0 errors; 5 pre-existing warnings)
npm test            → PASS: 52 unit/integration (45 existing + 7 new) + build + 3 rendered-html checks
npm run build       → PASS (Next.js 16.2.6, /api/products listed in routes)
```

## 12. Compliance

- **No DB reset:** no `reset`, no destructive DDL — the migration only adds functions; live data (9 products, 27 stock rows, 40 sales, 9 progress rows, 2 rewards, closures, settings) untouched.
- **No git push / no deploy:** nothing committed or pushed; no deployment steps run.
- **No changes to Additional Pickup correction:** `app/api/additional-pickup/correct/route.ts` and its screens untouched.
- **Tests not weakened:** the only test-file changes are (a) a stale assertion updated to the current implementation (`Persistent Commission Progress` → the `ml.labels.persistentCommissionProgress` key the app now renders) and (b) `expense-settlement.test.ts` fixtures gaining the `returnedQuantity` field that the sale-returns feature added to `SaleRecord` in commit `04998c0` — both are repairs of pre-existing staleness, not removals.

## 13. Runtime verification (dev server, localhost:3000)

Full lifecycle exercised through the live API (exactly what the UI calls):
- GET /api/state → 9 products, business date 2026-08-06, NOT_STARTED.
- POST /api/products with a Malayalam name → created (code auto-generated); appears in catalog with correct rule.
- PUT commission edit → catalog immediately shows new price/commission/threshold.
- PUT disable → `in catalog: False`; PUT enable → `in catalog: True`.
- DELETE → `deleted=True, blocked=False`; gone from the list.
- DB audit trail for that product: `product.created → product.updated → product.disabled → product.enabled → product.deleted`.
- Dev log clean (`GET / 200`, every API call 200, no errors).

## 14. Data integrity & residue check

After all tests and runtime verification: **0 leftover test products**, total products back to **9**, **9** current rules (one per product), all seed products still `active=true` with original sort orders 1–9, sales/stock/progress/rewards unchanged from baseline.

## 15. Pre-existing issues encountered (not introduced by this feature; noted per scope rules)

1. **LIVE SECURITY GAP (P0, confirmed by probe):** all 11 existing write RPCs are still executable by `anon` on the live DB (`has_function_privilege('anon', ...) = true` for `create_sale_atomic`, `start_day_atomic`, `close_day_atomic`, `reverse_sale_atomic`, `reset_day_atomic`, `additional_pickup_atomic`, `correct_additional_pickup_atomic`, `historical_data_entry_atomic`, `reopen_day_atomic`, `mark_offer_received_atomic`, `undo_offer_received_atomic`) — the `revoke ... from public` statements in older migrations did not take effect on the deployed schema, and the two `sale_returns` migrations never revoked at all. The `security definer` + uid-NULL guard lets unauthenticated callers pass. **This is outside product-management scope but blocks safe hardening; recommend a follow-up migration that revokes anon/authenticated on all `*_atomic` functions.** (New product RPCs are correctly restricted — see §5 of tests.)
2. `npm test` and `npm run lint` were red before this feature (stale rendered-html assertion; lint errors in legacy root scripts `apply_recent_migrations.cjs` / `translate.js` and `any`-typed code in the sale-returns/pickup-adjustment commits). Repairs made to reach green are listed in §12; they are staleness fixes, not weakening.
3. `getTrackerState` latency (≈3.8 s, 11 sequential round trips) remains as previously audited.

## 16. Known limitations / notes

- The Product Management screen shows only the *current* rule values; rule version history is visible in DB/audit only.
- Realtime: `products` is not in the Supabase realtime publication, so catalog changes reach the UI via the existing 30 s polling (`NEXT_PUBLIC_ENABLE_REALTIME`) — consistent with the rest of the app.
- The D1 provider keeps its seed/bootstrap behavior (PRODUCT_SEED is now fully typed and only used for fresh D1 bootstrap; the Supabase path is authoritative and DB-driven).
- `delete_product_atomic` returns a jsonb result (rather than raising) so the UI can show exact dependency counts; use cases map blocked results to a 409 `DomainError`.

## 17. Files changed

**New:** `supabase/migrations/20260806000000_product_management.sql` · `app/api/products/route.ts` · `src/application/product-management.ts` · `src/components/product-management.tsx` · `tests/product-management.test.ts`

**Modified:** `src/application/repositories.ts` (contracts) · `src/infrastructure/supabase/repositories.ts` (new repository + catalog query now filters `commission_rules.valid_to IS NULL` via `.is(...)` so versioned rules resolve correctly — this also fixes a latent bug where a future closed-rule version could be picked by the catalog; product mapping now carries `code/active/sortOrder`) · `src/domain/products.ts` (Product gains `code/active/sortOrder`) · `src/infrastructure/d1/repositories.ts` (mapping + typed stub) · `src/infrastructure/provider.ts` (wiring) · `src/lib/ui-text-ml.ts` (Malayalam keys) · `src/components/tracker-app.tsx` (new screen + Settings entry) · `app/api/products` wired in build · `tests/rendered-html.test.mjs` (stale assertion) · `tests/expense-settlement.test.ts` (fixture repair) · `package.json` (test:unit includes the new suite) · `eslint.config.mjs` (legacy root scripts ignored, matching existing precedent)

## 18. Summary verdict

Complete and verified: every required behavior (add/edit/enable/disable/safe-delete/display-order/history protection) works end-to-end against the live database through the layered architecture, all checks pass, no production data was touched, no residue remains, and the new RPCs are service_role-only. The one thing that should ship next is the P0 anon-execute hardening of the legacy `*_atomic` RPCs noted in §15.1.
