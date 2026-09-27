# PR #29 Production Readiness

**Updated 2026-09-27.** The feature migrations through `20260930060000` are recorded and their Production schema has been verified. A source review then found that authenticated clients could write service-line rows directly, bypassing the RPCs that recompute the order total and payment integrity. The corrective migration `20260930070000_restrict_service_item_writes_to_rpc.sql` is prepared locally and covered by regression tests, but has **not** been applied to Production or Staging. Apply and verify it before promoting the application.

## Release scope

- Mobile layout checks at 320px/375px and visual receipt/print checks are intentionally parked by the project owner. Receipt paper-fit QA should resume when the printer and paper size are selected.
- Supabase leaked-password protection is excluded from this release gate because it requires the Pro plan and there is no plan to upgrade.
- Production app deployment has not occurred. Merging to `main` automatically creates a Production deployment.

## Environments and PR

- Production Supabase ref: `yhckdhidchxsypfeyzxj`.
- Staging Supabase ref: `wmubrkhgncrtwdlsusea`.
- PR #29: `feat/multi-service-transactions`, head `836519b0b9f0e412cc930c5b58ea409f63b47089` before the corrective PR commit.
- The PR Preview was READY at that head and its loaded bundle targeted Staging, not Production.
- GitHub CI and the Vercel Preview check passed at that head. The new corrective commit must receive fresh CI and Preview checks after it is pushed.
- `main` is at `0c1a1eb094114eee959c9cd74979d172e24b6088`; the feature branch is one commit behind, with the main-only commit removing Claude delivery artifacts. GitHub reports the PR mergeable. No branch protection or required checks are configured. Repository rulesets have not been independently verified.

## Production migration and schema state

The authenticated Production CLI migration list confirms these feature versions are recorded as applied and match the local migration files:

- `20260930030000_transaction_service_items`
- `20260930040000_loyalty_points_include_service_items_kg`
- `20260930050000_prevent_terminal_transaction_edits`
- `20260930060000_pr29_advisor_hardening`

The previous spurious version `20260927092827` is absent after migration-history repair. Read-only Production catalog checks confirmed:

- `public.transaction_service_items`, `public.transaction_service_item_inventory_consumption`, and `public.transaction_inventory_consumption` exist.
- `public.create_transaction_with_service_items(jsonb,jsonb)` and `public.replace_transaction_service_items(uuid,timestamptz,jsonb,jsonb)` exist with the expected signatures.
- `private.is_drop_off_service(text)` has `search_path=""`.
- `transaction_service_items_created_by_idx` exists.

Pre-existing remote-only Production migration-history rows remain untouched. Staging also has substantial legacy history drift. Do not use `supabase db push` or `supabase migration up` against either project with the current migration directory as a drift workaround. The new `20260930070000` corrective migration is a local PR change only and needs an explicitly reviewed Production rollout before app promotion.

## Staging browser QA

Supplied authenticated QA passed for:

- Multi-service totals and Edit prefill, including primary ₱195 + additional ₱220 = ₱415 and GCash ₱415.
- Cash and GCash edit save paths for the primary-only amount fix.
- Stale two-tab edit rejection, with the newer value preserved and the stale draft rejected.
- Cancelled and Completed order edit guards.
- Drop-Off completion guard when the customer item list is missing.
- Inventory item selection, insufficient-stock rejection, and successful consumption on completion.
- Staff order viewing/edit access and Pay Later creation (`AQ-38E8D22F`, ₱90, Received). The temporary QA Staff account was disabled after the test; sign-in blocking was confirmed.

No Production data was used for browser QA. Staging fixtures and synthetic QA orders remain in Staging as documented by the QA reports; they are not release data.

## Source-review findings and correction

The initial migration granted `authenticated` direct `INSERT`, `UPDATE`, and `DELETE` on `transaction_service_items`. Those writes could alter child rows without recomputing the parent transaction total. Migration `20260930070000` revokes direct child-table mutations and removes their write policies, leaving reads available and directing changes through the total-validating create/replace RPCs. Regression coverage verifies direct writes fail while an authorized RPC edit still updates service lines and recalculates the parent total.

The service-line completion trigger previously locked inventory rows in service-line order, which could permit a deadlock when concurrent orders referenced the same items in different line orders. The corrective migration adds a BEFORE trigger that locks all primary and additional-service inventory rows in global UUID order before either consumption trigger runs. The PGlite suite verifies the lock ordering is present and that completion and stock validation tests pass. The suite does not simulate multi-session contention, Supabase API/Realtime transport, or external n8n export.

The Production PostgREST exposed-schema configuration has not been independently verified. The app migration assumes the `private` schema is not exposed; confirm the Production API's exposed schemas before release. The tool-backed database checks did not expose that platform setting.

## Local verification for the corrective change

- `node tests/backend/test.mjs`: 74 PASS, 0 FAIL.
- `npm run test:sales-metrics`: 12/12 passed.
- `npm run test:customer-items`: 8/8 passed.
- `npm run test:staff-accounts`: 5/5 passed.
- `npm run test:receipt`: 5/5 passed; rendered print QA remains parked.
- `npm run test:transaction-edit`: 3/3 passed.
- `npm run check:migrations`: passed with 50 migration files.
- `npx oxlint`: exit 0; existing 39-warning baseline, with no TypeScript source changes in this corrective patch.
- `npx tsc -b`: passed.
- `npm run build`: passed; Vite transformed 134 modules.
- `git diff --check`: passed.

## Remaining release actions

1. Independently confirm Production's PostgREST exposed schemas and finish the read-only review of the corrective migration.
2. Push the corrective code/migration commit and wait for its GitHub CI and Vercel Preview checks.
3. Apply `20260930070000` to Production only through a project-specific, reviewed migration procedure; record and verify its version and the direct-write privilege state. Do not run `db push` or `migration up` as a shortcut.
4. Re-check exact PR head/checks and Production schema after the migration.
5. Obtain the owner's explicit final merge approval. Merging automatically deploys the app to Production.
