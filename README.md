# Commission Compass

Commission Compass is a mobile-first sales commission tracker for a single salesman, built so the same domain and application layers can later support multiple users, companies, clients, and database providers.

## Business rule

Every product has an independent cycle. Sales 1–12 earn Normal Commission. When progress shows `12 / 12`, the next unit earns Full Commission equal to that product’s full-commission amount and earns no Normal Commission. The cycle then resets to `0 / 12`. Quantity is processed one unit at a time, so one sale can cross one or more cycle boundaries safely.

Money is stored as integer paise. The pure calculation service is in `src/domain/commission.ts`.

| Product | Price | Normal Commission | Full Commission |
| --- | ---: | ---: | ---: |
| Ghee 500 ML | ₹500 | ₹50 | ₹500 |
| Ghee 200 ML | ₹230 | ₹25 | ₹230 |
| Honey 1 KG | ₹900 | ₹100 | ₹900 |
| Honey 500 g | ₹450 | ₹50 | ₹450 |
| Honey 250 g | ₹250 | ₹25 | ₹250 |
| Small Honey 250 g | ₹750 | ₹50 | ₹750 |
| Koova Powder 250 g | ₹500 | ₹50 | ₹500 |
| Koova Powder 125 g | ₹250 | ₹25 | ₹250 |
| Oil | ₹250 | ₹15 | ₹250 |

## Architecture

```text
Mobile UI
  → route/application boundary
    → pure domain services
      → repository contracts
        → D1 adapter for the hosted private build
        → Supabase/PostgreSQL adapter and atomic RPC for production migration
```

React components never query a database. Supabase types are confined to infrastructure. Historical sales store price and commission snapshots. The schema carries `tenant_id`, `company_id`, `salesman_id`, and audit fields from the beginning.

Key folders:

- `app/`: pages and provider-neutral API boundary
- `src/domain/`: deterministic money and commission rules
- `src/application/`: DTOs and authoritative summary calculations
- `src/repositories/`: provider-neutral repository interfaces
- `src/infrastructure/`: database and Realtime adapters
- `db/` and `drizzle/`: hosted database schema and migrations
- `supabase/`: PostgreSQL migrations, RLS, Realtime publication, atomic sale RPC, and seed
- `tests/`: critical business-rule tests

## Local setup

Requirements: Node.js 22.13 or newer.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

The UI foundation follows shadcn/ui’s Radix design language and semantic tokens. `components.json` records the configuration. The requested preset command for a blank conventional Next project is:

```bash
npx shadcn@latest init --preset b1dnAGkiNk --base radix --template next
```

This repository preserves the Sites/vinext runtime, so the preset is represented by configuration and semantic component styling rather than allowing the initializer to replace the hosting structure.

## Commands

```bash
npm run test:unit
npm run typecheck
npm run lint
npm run build
npm test
npm run db:generate
```

## Supabase setup

1. Create a new Supabase project.
2. Install the Supabase CLI and link the project.
3. Run `supabase db push`.
4. Run `supabase db reset` locally to apply migrations and `supabase/seed.sql`, or execute the seed explicitly in a controlled environment.
5. Add the values from `.env.example` to the deployment environment.
6. Associate the real Auth user with the seeded salesman row before using authenticated RLS.
7. Call `public.create_sale_atomic` from the server application layer. Never calculate or persist authoritative commission values from the browser.

The migration:

- creates normalized tenant, company, salesman, product, rule, progress, sale, reward, day-close, settings, and audit tables;
- adds foreign keys, checks, unique constraints, and query indexes;
- enables RLS on every business table;
- restricts reads to authenticated company members;
- publishes sales, progress, rewards, and day closures to Supabase Realtime;
- protects each product/salesman cycle with a transaction-scoped advisory lock;
- returns an existing sale for the same salesman/idempotency key;
- creates the sale, rewards, progress update, and audit log in one transaction.

### Realtime

Implementations conform to `RealtimeService`. Subscribe only to the current company/salesman scope and these tables: `sales`, `commission_progress`, `full_commission_rewards`, and `day_closures`. Treat events as refresh signals, deduplicate by record ID, refresh after reconnect, and always unsubscribe on unmount. Realtime is never used for transaction correctness. The hosted adapter falls back to a 30-second refresh when push is unavailable.

### RLS verification

Create two users assigned to different companies. For each user, verify that reads return only their company’s products, progress, sales, rewards, closures, settings, and audits. Verify anonymous requests return no business rows. Use the service role only in server-side administrative operations and never expose it through `NEXT_PUBLIC_*`.

## Dashboard definitions

- Today’s Sales: sum of unit quantity
- Gross Sales: sum of unit selling value
- Total Commission: Normal Commission units × snapshotted Normal Commission
- Full Commission: Full Commission units × snapshotted Full Commission
- Total Earnings: Total Commission + Full Commission
- Net Collection: Gross Sales − Total Earnings

## Day Close and WhatsApp

Day Close stores a unique per-salesman/per-date snapshot. The UI requires confirmation, builds a professional report, URL-encodes it for `wa.me`, and leaves the final Send action to the user. A Copy Message fallback is always available. Configure the number in Settings or through the server-side environment fallback.

## Backup, restore, export, and import

### Supabase/PostgreSQL

```bash
supabase db dump --linked -f backups/schema.sql
supabase db dump --linked --data-only -f backups/data.sql
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" backup.dump
```

Keep encrypted backups outside the repository. Test restores in a separate project. After restore, compare row counts and recompute dashboard totals from sales snapshots.

For CSV/JSON exports, export tables in dependency order: tenants, companies, salesmen, products, commission rules, progress, sales, rewards, day closures, settings, and audit logs. Imports must be server-side, Zod-validated, wrapped in a transaction, dry-run first, and use stable IDs plus idempotency keys to prevent duplicates.

### Switching Supabase projects

1. Back up schema and data from Project A.
2. Create Project B and apply all migrations.
3. Restore data in dependency order.
4. update hosted Supabase URL and keys.
5. redeploy without changing application code.
6. compare table counts; verify total Gross Sales, Total Earnings, and Net Collection.
7. sample every product’s current progress and confirm each reward cycle is unique.
8. test one sale at `12 / 12`, RLS as two users, and all four Realtime subscriptions.

## Vercel and other hosting

The application contains no persistent business data on the local filesystem, no hardcoded deployment URL, and no PM2/Nginx dependency. Keep service keys server-only. The pure domain layer and repository contracts can move to Vercel, Railway, Render, Docker, Kubernetes, or a custom API without rewriting the commission rule or UI.

## Security and reliability

- integer paise calculations with safe-integer validation;
- server-side Zod validation and authoritative product/rule lookup;
- UUID idempotency keys;
- transaction-protected Supabase sale RPC with row/advisory locking;
- historical price/rule snapshots;
- RLS on all Supabase business tables;
- server-safe error messages and audit events;
- disabled save controls during requests;
- no optimistic success for financial writes.

## Troubleshooting

- Database unavailable: confirm the hosted `DB` binding or Supabase environment values.
- Empty Supabase results: check Auth user-to-salesman mapping and RLS.
- Duplicate sale: reuse of an idempotency key returns the original transaction.
- Realtime stopped: confirm table publication and RLS; the UI remains usable and refreshes safely.
- Wrong totals: never edit historical snapshots; validate sales through the atomic RPC and rerun unit tests.

## Future SaaS plan

Add role/membership tables and owner use cases, then scope product catalogs, rules, reporting, themes, and subscription limits by tenant/company. Android and desktop clients should call the same application API. Add authenticated offline capture only after implementing signed local storage, conflict resolution, server idempotency, and visible sync state.
