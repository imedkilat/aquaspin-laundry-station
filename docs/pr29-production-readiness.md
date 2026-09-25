# PR #29 Production Readiness

**Status as of 2026-09-26: DO NOT PROMOTE THE APPLICATION YET.** All three PR #29 migrations (`300300`, `300400`, `300500`) have been applied to Production and verified. The application fixes for cancelled-order edits and stale multi-tab saves are on the PR branch and its preview is READY, but those fixes still need browser retesting. Other browser checks and older migration-history drift remain open.

## Environment and deployment

- Production Supabase ref: `yhckdhidchxsypfeyzxj`.
- Staging Supabase ref: `wmubrkhgncrtwdlsusea`.
- PR #29 branch: `feat/multi-service-transactions`.
- Latest verified Vercel preview: commit `9bc3ec50aeb2b4a9caaef063a269afe6cbc79c5a`, READY. The stable PR alias points to this deployment. Its loaded app asset points to Staging and does not contain the Production project ref.
- The preview bundle points to Staging. Production application deployment was not changed.

## Production database state

With explicit approval, these migrations were applied to Production using `supabase migration up` with the exact project ref:

- `20260930030000_transaction_service_items.sql`
- `20260930040000_loyalty_points_include_service_items_kg.sql`
- `20260930050000_prevent_terminal_transaction_edits.sql`

Read-only post-apply verification confirmed:

```json
{
  "create_rpc": {"exists": true, "authenticated_execute": true},
  "replace_rpc": {"exists": true, "authenticated_execute": true},
  "migration_history": ["20260930030000", "20260930040000"],
  "service_items_table": {"exists": true, "policies": 3, "rls_enabled": true},
  "realtime_publication": true,
  "loyalty_function_reads_service_items": true,
  "service_item_inventory_consumption_table": {"exists": true, "rls_enabled": true}
}
```

For `20260930050000`, the CLI reported `Applying migration 20260930050000_prevent_terminal_transaction_edits.sql...` and `Migrations applied`. A read-only Production query then confirmed `function_exists`, `trigger_exists`, `security_invoker`, and `migration_recorded` were all `true`; a subsequent migration list showed `local` and `remote` both `20260930050000`.

The CLI initially refused `migration up` because 20 older remote history versions were absent from the PR branch's migration directory. To preserve those remote records, temporary no-op placeholders were added only to a disposable CLI workdir. They were not added to the repo and did not alter Production history. Those 20 legacy remote-only entries remain a repository/history reconciliation item. **Do not run `supabase db push` to work around this drift.**

The follow-up migration `20260930050000_prevent_terminal_transaction_edits.sql` has been applied to Production with explicit approval. It has **not** been applied to Staging. The Production CLI workdir included temporary empty placeholders for the 20 remote-only legacy migration records, allowing the preflight list to confirm that `300500` was the only pending migration. The placeholders and linked project configuration exist only in the disposable workdir under the system temp directory; they were not committed and did not alter the Production history beyond recording `300500`.

A read-only Staging `migration list --project-ref wmubrkhgncrtwdlsusea` showed the two feature versions (`20260930030000` and `20260930040000`) matched, but many earlier local versions had no remote row and 18 remote-only versions had no local file. Do not run `migration up` against Staging with the full PR migration directory until this separate drift is reconciled; it could attempt to replay old SQL. No Staging database change was made during this follow-up.

## Latest Staging browser QA

The latest supplied browser QA was run against stable alias commit `0e86beeb468e2ce07e9fce21ddd8a9428e9ef2f3`. Production was not accessed during that QA run. Later PR previews including `9bc3ec5` are READY, but neither cancelled-order behavior nor the stale-edit fix has been retested on the updated preview.

| Check | Result | Evidence |
| --- | --- | --- |
| Staff transaction permissions and Pay Later | Blocked | Owner session only; no authorized Staff session. |
| Multi-service totals and Edit form | Pass | `AQ-4C9FB66C`: ₱195 primary + ₱220 additional = ₱415; GCash ₱415; Edit prefill matched. |
| Stale-edit protection | Inconclusive on tested build; fix awaiting retest | Controlled Tab B save left Tab A's newer note visible, but there was no explicit rejection or request-level evidence. The PR follow-up now preserves the editor's initial version token and does not remount the modal on realtime updates. |
| Cancelled-order edit guard | Fail on tested build; fix awaiting retest | `AQ-4002F39B` was Cancelled, but Edit opened with Save Changes enabled. The dialog was canceled without saving. The PR follow-up now hides and guards Edit, and the database trigger is applied to Production. Browser retest remains pending. |
| Drop-Off completion guard | Pass | `AQ-19B13273` reached Ready for Pickup; missing customer item list warning displayed and completion was disabled. |
| Receipt and print styling | Blocked | Print action calls `window.print()`; no safe print preview or print-media emulation. |
| 320px and 375px layouts | Blocked | Browser did not expose viewport resizing. |
| Inventory consumption and insufficient stock | Blocked | No active Staging inventory fixtures; no inventory was changed. |

Three synthetic Staging orders were created for this QA run: `AQ-4C9FB66C` (Received), `AQ-4002F39B` (Cancelled), and `AQ-19B13273` (Ready for Pickup). They were not deleted. Existing orders and real customer data were not changed. No app-origin console error or new Warp timeout was observed; request IDs/statuses were unavailable.

## Fix for cancelled and completed order edits

The QA failure exposed two gaps: the detail page offered Edit for terminal orders, and a direct authenticated update could change transaction fields after cancellation/completion. The PR follow-up:

- Hides Edit and unmounts an open editor when an order is completed or cancelled.
- Disables and guards the modal save path for terminal orders.
- Adds a database trigger that rejects changes to terminal transaction details while allowing audited status changes, soft deletion/restoration metadata, and SMS delivery metadata.
- Adds backend regression assertions for completed/cancelled rows and verifies that editing works again after an Owner reopens the order.

The migration preserves the more specific existing error for terminal inventory edits by running after that guard. It is applied to Production; Staging remains unchanged because its migration history is separately drifted.

The two-tab result also exposed a client-side verification gap: the Edit modal boundary key included `updated_at`, so a realtime update could remount the modal and discard an in-progress draft. The follow-up removes that version from the key, captures the opening `updated_at`, and refuses to save when the transaction prop has advanced. Both the plain update and multi-service RPC use that captured token. Browser retesting is still required to confirm the visible stale-save error.

## Local verification on the follow-up PR source

- `node tests/backend/test.mjs`: 74 PASS, 0 FAIL. The suite does not run multi-session contention, Supabase API/Realtime transport, or external n8n export.
- `npm run check:migrations`: passed with 48 migration files.
- `npx oxlint`: exit 0, 39 warnings (same baseline).
- `npx tsc -b`: exit 0.
- `npm run build`: passed; Vite transformed 133 modules. The un-elevated sandbox attempt hit Windows `spawn EPERM`; the elevated local rerun passed.
- Supabase Production advisors reported existing security/performance findings. The new `transaction_service_items.created_by` foreign key has no covering index; review whether to add one before release. Other advisor results include pre-existing project findings and unused fresh indexes.

## Release gates still open

1. Repeat cancelled-order browser QA against the updated preview and confirm Edit is unavailable.
2. Repeat the controlled two-tab stale-edit test and confirm the older editor keeps its draft, rejects Save with the stale-version message, and cannot overwrite the newer note.
3. Obtain an authorized Staff session for Staff/Pay Later checks.
4. Run mobile layout and receipt/print checks with browser capabilities that support viewport sizing and print preview.
5. Configure approved disposable Staging inventory fixtures before stock UI tests; do not consume or alter real stock.
6. Reconcile the remaining remote-only migration-history entries with committed migration sources and a documented rollout procedure.
7. Review advisor findings and the new foreign-key index recommendation.
8. Promote only after the above gates pass, then smoke-test the exact production deployment.
