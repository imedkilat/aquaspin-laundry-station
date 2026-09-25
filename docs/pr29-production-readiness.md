# PR #29 Production Readiness

**Status as of 2026-09-25: DO NOT PROMOTE THE APPLICATION YET.** The two PR #29 feature migrations have been applied to Production and verified. Browser QA still has blocked and inconclusive checks, the cancelled-order edit defect needs the follow-up migration in this PR, and older migration-history drift remains.

## Environment and deployment

- Production Supabase ref: `yhckdhidchxsypfeyzxj`.
- Staging Supabase ref: `wmubrkhgncrtwdlsusea`.
- PR #29 branch: `feat/multi-service-transactions`.
- Latest verified Vercel preview: commit `0e86beeb468e2ce07e9fce21ddd8a9428e9ef2f3`, READY. Its stable PR alias points to the same deployment.
- The preview bundle points to Staging. Production application deployment was not changed.

## Production database state

With explicit approval, these migrations were applied to Production using `supabase migration up` with the exact project ref:

- `20260930030000_transaction_service_items.sql`
- `20260930040000_loyalty_points_include_service_items_kg.sql`

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

The CLI initially refused `migration up` because 20 older remote history versions were absent from the PR branch's migration directory. To preserve those remote records, temporary no-op placeholders were added only to a disposable CLI workdir. They were not added to the repo and did not alter Production history. Those 20 legacy remote-only entries remain a repository/history reconciliation item. **Do not run `supabase db push` to work around this drift.**

The follow-up migration `20260930050000_prevent_terminal_transaction_edits.sql` is a local PR change and has **not** been applied to Production. Apply it only after review and explicit approval.

## Latest Staging browser QA

At 2026-09-25 15:03 UTC, the stable PR alias was READY on commit `0e86beeb468e2ce07e9fce21ddd8a9428e9ef2f3` and its app asset pointed to Staging. Production was not accessed during this QA run.

| Check | Result | Evidence |
| --- | --- | --- |
| Staff transaction permissions and Pay Later | Blocked | Owner session only; no authorized Staff session. |
| Multi-service totals and Edit form | Pass | `AQ-4C9FB66C`: ₱195 primary + ₱220 additional = ₱415; GCash ₱415; Edit prefill matched. |
| Stale-edit protection | Inconclusive | Controlled Tab B save left Tab A's newer note visible, but there was no explicit rejection or request-level evidence. |
| Cancelled-order edit guard | Fail, fix in progress | `AQ-4002F39B` was Cancelled, but Edit opened with Save Changes enabled. The dialog was canceled without saving. |
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

The migration preserves the more specific existing error for terminal inventory edits by running after that guard. It must be applied to Production before promoting this application fix.

## Local verification on the follow-up PR source

- `node tests/backend/test.mjs`: 74 PASS, 0 FAIL. The suite does not run multi-session contention, Supabase API/Realtime transport, or external n8n export.
- `npm run check:migrations`: passed with 48 migration files.
- `npx oxlint`: exit 0, 39 warnings (same baseline).
- `npx tsc -b`: exit 0.
- `npm run build`: passed; Vite transformed 133 modules. The un-elevated sandbox attempt hit Windows `spawn EPERM`; the elevated local rerun passed.
- Supabase Production advisors reported existing security/performance findings. The new `transaction_service_items.created_by` foreign key has no covering index; review whether to add one before release. Other advisor results include pre-existing project findings and unused fresh indexes.

## Release gates still open

1. Review the new terminal-order guard migration and apply it to Production through the approved migration workflow; verify the trigger and migration history afterward.
2. Repeat cancelled-order browser QA against the updated preview and confirm Edit is unavailable. Verify stale-edit behavior with request-level evidence if available.
3. Obtain an authorized Staff session for Staff/Pay Later checks.
4. Run mobile layout and receipt/print checks with browser capabilities that support viewport sizing and print preview.
5. Configure approved disposable Staging inventory fixtures before stock UI tests; do not consume or alter real stock.
6. Reconcile the remaining remote-only migration-history entries with committed migration sources and a documented rollout procedure.
7. Review advisor findings and the new foreign-key index recommendation.
8. Promote only after the above gates pass, then smoke-test the exact production deployment.
