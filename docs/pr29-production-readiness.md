# PR #29 Production Readiness

**Status as of 2026-09-25: DO NOT DEPLOY.** This is a read-only assessment and rollout plan. No Production schema, migration history, data, or deployment was changed while preparing it.

## Project and application state

- Production Supabase project: `yhckdhidchxsypfeyzxj` (`Aquaspin Supabase`), `ACTIVE_HEALTHY`, PostgreSQL 17.6.1.166.
- Staging Supabase project: `wmubrkhgncrtwdlsusea`.
- PR #29 source branch: `feat/multi-service-transactions`.
- The supplied browser QA evidence confirms the existing GCash multi-service order `AQ-7C08D84E` displays ₱195 primary + ₱220 additional = ₱415 grand total, and its Edit form opens with those values. Cancel left the order Received at ₱415. No data was changed.
- The Edit modal now has an accessible dialog role/name (commit `6c48c8b5880cc60556ead0e28faab64367f16dad`). The earlier one-click no-response observation remains unexplained; it is not evidence of a database timeout.

## Production database checks

Read-only catalog checks against the exact Production project returned:

```json
[{"service_items_table_exists":false,"create_rpc_exists":false,"replace_rpc_exists":false,"loyalty_counts_service_items":false,"pr29_migration_history_rows":0}]
```

The required PR #29 migrations are therefore absent from both the Production schema and its migration ledger:

- `20260930030000_transaction_service_items.sql`
- `20260930040000_loyalty_points_include_service_items_kg.sql`

The current repository contains 47 migration files; Production reports 44 ledger rows. An exact-version comparison found 24 matching version IDs, 18 likely historical timestamp aliases (same migration name after removing an embedded timestamp), three older local migrations without an exact Production version, and the two new PR #29 migrations. Production also has two ledger entries whose names do not exactly match a local migration name. These are candidates for reconciliation, **not proof of SQL equivalence**. The `discounts_promos` table exists in Production even though the local migration version has no exact Production ledger entry.

Do not run `supabase db push` against the current drifted state. Do not mass-mark migrations applied based on matching names. `migration repair` changes bookkeeping only; it does not apply SQL. Supabase's migration guide describes these as separate operations: [Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations) and [CLI migration repair reference](https://supabase.com/docs/reference/cli/supabase-migration-repair).

## Required Production rollout gates

1. **Capture and review the exact ledger delta.** The Supabase CLI is not installed in this workstation, so no CLI migration-list or dry-run command has been run. Install/pin a CLI version for the release, link this repo explicitly with `supabase link --project-ref yhckdhidchxsypfeyzxj`, verify that exact ref in the command output, then save the full `supabase migration list --linked` output. Compare every remote-only/local-only version; do not rely on this summary as a substitute for the CLI's own comparison.
2. **Prove each historical alias.** For each proposed local/remote pair, compare the SQL statements actually recorded in Production with the local migration and verify the resulting objects, grants, policies, triggers, and constraints. Resolve the three unmatched older migrations and two remote-only names explicitly. If a migration's effect cannot be proven, stop and prepare a schema-diff/reconciliation migration; do not repair its history merely to make the lists look aligned.
3. **Review and approve a minimal history-repair plan.** Only after step 2, document the exact versions to mark `applied` or `reverted` and why. Use `supabase migration repair --linked` only after the explicit Production link has been verified. Never edit `supabase_migrations.schema_migrations` through raw SQL.
4. **Verify the dry run.** Re-run `supabase migration list --linked` and `supabase db push --dry-run --linked` only after reconciliation. The CLI's documented push interface uses a linked project or `--db-url`; it does not take `--project-ref` directly. Proceed only if it proposes exactly the two PR #29 migrations and no historical SQL. If the CLI reports any other migration, stop.
5. **Apply the reviewed schema changes before promoting the UI.** Apply `20260930030000` first, then `20260930040000`, through the approved migration workflow. Keep the current app deployed until both migrations complete and post-apply checks pass.
6. **Verify the resulting Production contract.** Confirm the table, RLS policies, indexes, both RPC signatures and authenticated grants, and that `private.award_loyalty_points_on_completion()` includes additional service-line kg. Run security/performance advisors and attach the results to the release record.
7. **Promote the application only after database verification.** Confirm the Vercel production target and exact source commit. Roll back the application to its previous deployment if the smoke check fails. Do not drop the new table or revert the loyalty function after real multi-service orders exist; use a forward migration for database corrections.

## QA still required before release

The latest supplied browser evidence covers Owner access, one existing GCash multi-service order, Edit display, and Cancel. It does not cover:

- Staff view/edit and Pay Later permissions (no authorized Staff session supplied).
- Mobile widths 320px and 375px (current cloud browser lacks viewport resizing).
- Stale-edit protection, cancelled-order edit guard, and Drop-Off completion enforcement in the UI.
- Receipt layout/print flow.
- Inventory consumption and insufficient-stock UI behavior (Staging previously had zero active inventory items and categories).

These checks require suitable Staging fixtures/capabilities. Do not create QA orders, configure inventory, change statuses, or access Production as part of this read-only release plan.

## Local verification recorded for the current source

- `npx oxlint`: exit 0, 39 existing warnings.
- `node tests/backend/test.mjs`: 74 PASS, 0 FAIL. Multi-session contention, Supabase API/Realtime transport, and external n8n export were not run.
- `npx tsc -b`: exit 0.
- `npm run build`: migration check passed for 47 files; Vite transformed 133 modules and built successfully. The first sandbox attempt hit Windows `spawn EPERM`; the elevated local rerun passed.

Passing local checks do not clear the Production schema/history gate or the remaining browser QA items.
