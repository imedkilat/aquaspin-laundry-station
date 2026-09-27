# PR #29 Production Readiness

**Updated 2026-09-27.** Production migrations through `20260930070000` are recorded and the corrective schema changes are verified. Migration `300700` revokes direct authenticated writes to service lines, serializes completion inventory locks, restricts service replacement to Owners/edit-enabled Staff, and preserves multi-service creation for create-only Staff. It has **not** been applied to Staging. The application has not been merged or deployed to Production.

## Release scope

- Mobile layout checks at 320px/375px and visual receipt/print checks are intentionally parked by the project owner. Receipt paper-fit QA should resume when the printer and paper size are selected.
- Supabase leaked-password protection is excluded from this release gate because it requires the Pro plan and there is no plan to upgrade.
- Production app deployment has not occurred. Merging to `main` automatically creates a Production deployment.

## Environments and PR

- Production Supabase ref: `yhckdhidchxsypfeyzxj`.
- Staging Supabase ref: `wmubrkhgncrtwdlsusea`.
- PR #29: `feat/multi-service-transactions`. Consult the live PR checks for its current head and deployment status; documentation-only commits can advance the head without changing application code.
- The latest branch revision checked while preparing this report had GitHub Actions CI and its Vercel Preview deployment both READY. The live PR Checks page is the source of truth for later commits.
- `main` is at `0c1a1eb094114eee959c9cd74979d172e24b6088`; the feature branch is one commit behind, with the main-only commit removing Claude delivery artifacts. GitHub reports the PR mergeable. No branch protection, required checks, or repository rulesets were reported in the independent GitHub API check.

## Production migration and schema state

The authenticated Production CLI migration list confirms these feature versions are recorded as applied and match the local migration files:

- `20260930030000_transaction_service_items`
- `20260930040000_loyalty_points_include_service_items_kg`
- `20260930050000_prevent_terminal_transaction_edits`
- `20260930060000_pr29_advisor_hardening`
- `20260930070000_restrict_service_item_writes_to_rpc`

The previous spurious version `20260927092827` is absent. The Supabase migration tool initially recorded `300700` under generated version `20260927113119`; the authenticated CLI repaired that row to reverted and recorded `20260930070000` as applied without re-executing the SQL. The final CLI list shows local and remote `20260930070000` matching and no `20260927113119`. Read-only Production catalog checks confirmed:

- `public.transaction_service_items`, `public.transaction_service_item_inventory_consumption`, and `public.transaction_inventory_consumption` exist.
- `public.create_transaction_with_service_items(jsonb,jsonb)` and `public.replace_transaction_service_items(uuid,timestamptz,jsonb,jsonb)` exist with the expected signatures.
- `private.is_drop_off_service(text)` has `search_path=""`.
- `transaction_service_items_created_by_idx` exists.
- Authenticated has SELECT but not INSERT/UPDATE/DELETE on `transaction_service_items`; the only remaining RLS policy is SELECT.
- The public create/replace RPCs remain executable by `authenticated` and not by `anon`. The inventory lock trigger helper exists and is not executable by `authenticated`.

Pre-existing remote-only Production migration-history rows remain untouched. Staging also has substantial legacy history drift, and `300700` remains unapplied there. Do not use `supabase db push` or `supabase migration up` against either project with the current migration directory as a drift workaround.

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

The initial migration granted `authenticated` direct `INSERT`, `UPDATE`, and `DELETE` on `transaction_service_items`. Those writes could alter child rows without recomputing the parent transaction total. Production migration `20260930070000` revokes direct child-table mutations and removes their write policies, leaving reads available and directing changes through the total-validating create/replace RPCs. Regression coverage verifies direct writes fail while an authorized RPC edit still updates service lines and recalculates the parent total.

The service-line completion trigger previously locked inventory rows in service-line order, which could permit a deadlock when concurrent orders referenced the same items in different line orders. The corrective migration adds a BEFORE trigger that locks all primary and additional-service inventory rows in global UUID order before either consumption trigger runs. The PGlite suite verifies the lock ordering is present and that completion and stock validation tests pass. The suite does not simulate multi-session contention, Supabase API/Realtime transport, or external n8n export.

Claude's read-only Production dashboard check reported that the Data API exposes `graphql_public` and `public`, while `private` is unchecked; the function panel labels `private.replace_transaction_service_items_rows` “Schema not exposed.” This closes the REST/RPC exposure concern for the reported Production configuration. It does not prove direct HTTP behavior, and no endpoint call was made. The helper's authenticated SQL EXECUTE grant remains intentional for calls from the public security-invoker RPCs.

The independent source review also found that the original replace RPC accepted `create_transactions` as edit authorization and did not fail if the parent UPDATE affected zero rows. Migration `300700` now requires Owner or `edit_transactions` for replacement and raises if the parent update is blocked, rolling back child-row changes. Regression coverage verifies create-only Staff cannot replace an existing order and that both parent and child rows remain unchanged. It separately verifies create-only Staff can still create a multi-service order through the atomic create RPC.

## Local verification for the corrective change

- `node tests/backend/test.mjs`: 74 PASS, 0 FAIL, including create-only create/edit permission coverage.
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

1. Keep `300700` unapplied in Staging unless a separate Staging rollout is requested.
2. Verify the current PR head and required checks immediately before merging.
3. Obtain the owner's explicit final merge approval. Merging automatically deploys the app to Production.
