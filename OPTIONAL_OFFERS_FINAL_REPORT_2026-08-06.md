# AL QUWWA — Optional Offers (Offer Toggle) Feature: Final Report

**Date:** 2026-08-06 · **Scope:** optional-Offer support end-to-end · **No git push, no deploy, no DB reset.**

---

## 1. What was implemented

Salesmen can mark a product as **offer-less** ("ഓഫർ ഇല്ല") from the Manage Products screen: the product then earns **Normal Commission only** on every sale — no free-unit cycles, no progress tracking, no rewards. Offer products keep the existing 13th-sale cycle behavior exactly. The toggle is enforced at every layer: form → API → use case → repository → DB constraint → commission engine (including sale reversal, historical entry, and day reset).

## 2. Data model (migration `20260806000100_optional_offers.sql`, applied live)

Additive column + tightened constraint, no existing data rewritten:

- `commission_rules.offer_enabled boolean NOT NULL DEFAULT true` — new products default to offer-on.
- `full_commission_paise` / `reward_threshold` made **nullable** (NOT NULL + default dropped).
- New check `commission_rules_offer_consistency_check`: `offer_enabled = true` → both fields NOT NULL and `> 0`; `offer_enabled = false` → both NULL.
- Live data validated cleanly before apply (all 9 rules offer-on, threshold 12).
- Sales snapshots store `coalesce(..., 0)`; **`reward_threshold_snapshot = 0` marks an offer-less sale** — reversal replays it as 100% normal units. Historical sales are never recalculated.

## 3. RPC changes (same migration)

| RPC | Change |
|---|---|
| `upsert_product_atomic` | New 12-arg signature (`p_offer_enabled` after normal commission); old 11-arg overload dropped. Rule versioning unchanged (close current → open new). |
| `create_sale_atomic` | Offer-less branch: `normal_units = quantity`, no progress lock/loop, no progress row update, no rewards; snapshots `0`. Offer path unchanged. |
| `reverse_sale_atomic` | Replay: threshold snapshot `0` → all units normal; final progress UPDATE no-ops when no row exists. |
| `historical_data_entry_atomic` | Offer-less: skips progress lock/recompute, replays all-normal. |
| `reset_day_atomic` | Uses each product's **current rule threshold** (replaces hardcoded 12); skips progress rebuild for offer-less products. |
| `list_product_management_atomic` | Returns `offer_enabled` + nullable offer fields. |

**Security side-effect (partial P0 fix):** anon was revoked from all five redefined RPCs and `list_product_management_atomic` is service_role-only; `check_anon_privs.cjs` confirms no ANON-EXEC for these. **Still open (P0, pre-existing):** `additional_pickup_atomic`, `close_day_atomic`, `correct_additional_pickup_atomic`, `mark_offer_received_atomic`, `reopen_day_atomic`, `start_day_atomic`, `undo_offer_received_atomic` remain anon-executable on the live DB — recommend the hardening migration next.

## 4. Layering

- **Domain:** `Product` / `CommissionRule` gain `offerEnabled`. `calculateSale` no-offer mode: all units normal, `finalProgress 0`, `finalCycle 1`, zero cycles; progress validation skipped. `PRODUCT_SEED` (9 entries) all `offerEnabled: true` — D1 bootstrap only.
- **API/use case:** `app/api/products/route.ts` zod — `sellingPricePaise >= 1`, `offerEnabled` required boolean, nullable offer fields, `superRefine` requiring both when enabled; use case normalizes `fullCommissionPaise`/`rewardThreshold` to `null` when disabled; `validateProductInput` requires full ≥ 1 and threshold 1–999 when enabled.
- **Supabase repo:** catalog select now includes `offer_enabled`; mapping `offer_enabled !== false`, thresholds `0`-defaulted when null; upsert RPC call passes `p_offer_enabled`.
- **D1:** `products.offer_enabled INTEGER NOT NULL DEFAULT 1` DDL; `createSale` gathers `offerEnabled` and conditionally builds the progress-update + reward-insert batch; tracker product mapping carries it.

## 5. UI

- `product-management.tsx`: switch-row toggle (`role="switch"`, label "ഓഫർ ലഭ്യമാണോ?"); offer fields render only when enabled; empty form defaults `offerEnabled: false`, threshold `""` (was `"12"`); list row shows offer state; payloads carry `offerEnabled` (enable/disable toggles included).
- `tracker-app.tsx`: no-offer guards in the sale drawer (Offers Earned row, progress row → "സാധാരണ കമ്മീഷൻ മാത്രം"), pickup card, sale product cards (badge + progress track), and offer-ready list.
- `ui-text-ml.ts` new keys: `offerAvailable`, `offerAvailableHint`, `noOffer`, `normalCommissionOnly`.

## 6. Tests — ALL GREEN

`npm run typecheck` PASS · `npm run lint` PASS (0 errors; 5 pre-existing warnings) · `npm test` PASS **58/58 unit/integration + build + 3/3 rendered-html**.

New coverage: 2 commission tests (offer-less: all-normal, zero progress/cycles, stale-progress immunity) + 4 product-management tests:
1. Zero/negative price rejected.
2. No-offer create → rule row has NULL offer fields, catalog shows `offerEnabled=false` / thresholds 0.
3. Enable-offer versioning → 2 rules (old closed, new current with 6000/5).
4. Live engine (fake salesman + open session): offer-less 3q → 3 normal / 0 full / zero progress row / zero rewards; reverse 1 unit → still all-normal; offer control (threshold 2, 3q) → 2 normal + 1 full + progress (0,2) + 1 reward cycle 1; full cleanup.

Also repaired: `select tenant_id, id as company_id` and audit-cleanup `$1`/`$2` param mismatch (both test-infra bugs, not product code).

## 7. Runtime verification (dev server localhost:3000)

- POST `/api/products` no-offer product → stored `offer_enabled=false`, `full_commission_paise=NULL`, `reward_threshold=NULL`; `GET /api/state` catalog shows `offerEnabled=false`, `fullCommissionPaise=0`, `rewardThreshold=0` (the earlier "0 products" probe was a PowerShell `.state.products` path mistake — the root response is the state).
- PUT enable (full 6000 / threshold 5) → 2 rule versions, new one current, catalog shows 6000/5.
- PUT disable → 3rd version current (NULL fields), catalog `offer=false`.
- DELETE → `deleted=true`, all usage counts 0.
- **Residue:** 0 rules/products/audit for the throwaway; products back to **9**; zero offer-less rules remain.

## 8. Compliance

- No DB reset; migration additive (column + check + function redefinitions); all 9 real products, 27 stock rows, 40 sales, progress, rewards, closures untouched.
- No git push / no deploy. Tests only extended, never weakened.
- Historical sales untouched by design (snapshot/versioning model, §2).

## 9. Files changed

**New:** `supabase/migrations/20260806000100_optional_offers.sql` · `OPTIONAL_OFFERS_FINAL_REPORT_2026-08-06.md`

**Modified:** `src/domain/products.ts` · `src/domain/commission.ts` · `src/application/repositories.ts` · `src/application/product-management.ts` · `app/api/products/route.ts` · `src/infrastructure/supabase/repositories.ts` · `src/infrastructure/d1/database.ts` · `src/infrastructure/d1/repositories.ts` · `src/components/product-management.tsx` · `src/components/tracker-app.tsx` · `src/lib/ui-text-ml.ts` · `tests/commission.test.ts` · `tests/business-day.test.ts` · `tests/product-management.test.ts`

## 10. Summary verdict

Complete and verified: the offer toggle works end-to-end against the live database — creation, enable/disable versioning, runtime catalog, engine (sales/reversal/historical/reset), UI, and cleanup — with the full gate green and zero residue. Next step (flagged, not in scope): the remaining 7 anon-executable legacy `*_atomic` RPCs.
