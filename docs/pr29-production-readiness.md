# PR #29 Production Readiness

**Status as of 2026-09-26: DO NOT PROMOTE THE APPLICATION YET.** Migrations `300300`, `300400`, and `300500` have been applied to Production and verified. A follow-up advisor-hardening migration (`300600`) is prepared locally but has not been applied to either database. The cancelled-order edit and stale multi-tab save fixes passed browser QA on preview commit `9bc3ec50aeb2b4a9caaef063a269afe6cbc79c5a`. Staff, mobile, print, inventory, Auth configuration, and older migration-history reconciliation remain open.

## Environment and deployment

- Production Supabase ref: `yhckdhidchxsypfeyzxj`.
- Staging Supabase ref: `wmubrkhgncrtwdlsusea`.
- PR #29 branch: `feat/multi-service-transactions`.
- Latest verified app-code preview: commit `9bc3ec50aeb2b4a9caaef063a269afe6cbc79c5a`, READY. The stable PR alias is READY on the latest docs-only branch commit and serves the same app bundle. The loaded asset points to Staging and does not contain the Production project ref.
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
  "migration_history": ["20260930030000", "20260930040000", "20260930050000"],
  "service_items_table": {"exists": true, "policies": 3, "rls_enabled": true},
  "realtime_publication": true,
  "loyalty_function_reads_service_items": true,
  "service_item_inventory_consumption_table": {"exists": true, "rls_enabled": true}
}
```

For `20260930050000`, the CLI reported `Applying migration 20260930050000_prevent_terminal_transaction_edits.sql...` and `Migrations applied`. A read-only Production query then confirmed `function_exists`, `trigger_exists`, `security_invoker`, and `migration_recorded` were all `true`; a subsequent migration list showed `local` and `remote` both `20260930050000`.

The CLI initially refused `migration up` because 20 older remote history versions were absent from the PR branch's migration directory. To preserve those remote records, temporary no-op placeholders were added only to a disposable CLI workdir. They were not added to the repo and did not alter Production history. Those 20 legacy remote-only entries remain a repository/history reconciliation item. **Do not run `supabase db push` to work around this drift.**

The follow-up migration `20260930050000_prevent_terminal_transaction_edits.sql` has been applied to Production with explicit approval. It has **not** been applied to Staging. The Production CLI workdir included temporary empty placeholders for the 20 remote-only legacy migration records, allowing the preflight list to confirm that `300500` was the only pending migration. The placeholders and linked project configuration exist only in the disposable workdir under the system temp directory; they were not committed and did not alter the Production history beyond recording `300500`.

The follow-up `20260930060000_pr29_advisor_hardening.sql` pins `private.is_drop_off_service` to an empty search path and adds an index to `transaction_service_items.created_by`. It is prepared in the PR worktree but has not been applied to Production or Staging. This optional hardening follow-up is not a substitute for migration-history reconciliation.

A read-only `npx supabase migration list --project-ref wmubrkhgncrtwdlsusea` on 2026-09-26 showed only the two feature versions (`20260930030000` and `20260930040000`) matched. The current PR worktree has 47 local-only versions and Staging has 41 remote-only versions; `20260930050000` and `20260930060000` are among the local-only versions. Do not run `migration up` against Staging with this migration directory: it would treat many historical local migrations as pending and could replay old SQL. Similar-looking migration names at different version IDs are not proof that the SQL/effects match. No Staging database change was made.

A read-only `npx supabase migration list --project-ref yhckdhidchxsypfeyzxj` on 2026-09-26 showed all 48 previously applied PR-worktree versions matching Production, with 20 additional remote-only history rows; `20260930060000` is the only local pending version. Production history was not changed by these list commands.

## Latest Staging browser QA

The latest supplied browser QA was run against the READY PR preview at commit `9bc3ec50aeb2b4a9caaef063a269afe6cbc79c5a`. Its app asset pointed to Staging (`wmubrkhgncrtwdlsusea`) and not Production (`yhckdhidchxsypfeyzxj`). Production was not accessed during browser QA.

| Check | Result | Evidence |
| --- | --- | --- |
| Staff transaction permissions and Pay Later | Blocked | Owner session only; no authorized Staff session. |
| Multi-service totals and Edit form | Pass | `AQ-4C9FB66C`: ₱195 primary + ₱220 additional = ₱415; GCash ₱415; Edit prefill matched. |
| Stale-edit protection | Pass | Confirmed again on stable alias at READY commit `290988102a4b9199bd375aa00be30ce6639e8b2e`: Tab A saved `QA-PR29-NEWER-A-20260926T0021PH` at `2026-09-25 16:23:17.595 UTC`. Tab B retained `QA-PR29-STALE-DRAFT-B-20260926T0021PH`; its one Save attempt at `16:23:28.371 UTC` showed the stale-version rejection. Tab B retained its draft, while the order remained at Tab A's newer marker. No retry. |
| Cancelled-order edit guard | Pass | `AQ-4002F39B` remained Cancelled and had no Edit button. No status or order fields were changed. |
| Drop-Off completion guard | Pass | `AQ-19B13273` reached Ready for Pickup; missing customer item list warning displayed and completion was disabled. |
| Receipt and print styling | Blocked | Print action calls `window.print()`; no safe print preview or print-media emulation. |
| 320px and 375px layouts | Blocked | Browser did not expose viewport resizing. |
| Inventory consumption and insufficient stock | Blocked | No active Staging inventory fixtures; no inventory was changed. |

The synthetic Staging orders remain: `AQ-4C9FB66C` (Received), `AQ-4002F39B` (Cancelled), and `AQ-19B13273` (Ready for Pickup). The latest stale-edit test changed only `AQ-4C9FB66C` Notes to `QA-PR29-NEWER-A-20260926T0021PH`; Tab B's stale marker remained unsaved in its open form. No other order or field was changed. Original `/orders` and unfinished `/new` tabs were preserved. No app-origin request error was attributed.

A later read-only attempt used the immutable preview deployment `dpl_S63PRmnwhvjriqkAco6EikfSAjTE` at commit `9bc3ec50aeb2b4a9caaef063a269afe6cbc79c5a`. Its JavaScript asset pointed to Staging and not Production, but the new tab redirected to `/login` and no authorized Owner session was available on that hostname. The attempt stopped there: `AQ-4002F39B` and `AQ-4C9FB66C` were not opened, no credentials were entered, no orders/data changed, and existing tabs plus the unfinished `/new` draft were untouched. This does not invalidate the earlier authenticated QA PASS on the stable alias; the immutable hostname attempt itself provides no order-level QA evidence. Use the stable alias with an already-authorized Owner session for any repeat checks.

The supplied follow-up QA on stable alias commit `290988102a4b9199bd375aa00be30ce6639e8b2e` restored the authenticated Owner session and reconfirmed both guards. `AQ-4002F39B` remained Cancelled without an Edit button. On `AQ-4C9FB66C`, Tab A's Notes marker `QA-PR29-NEWER-A-20260926T0021PH` saved at `2026-09-25 16:23:17.595 UTC`; Tab B's stale marker `QA-PR29-STALE-DRAFT-B-20260926T0021PH` remained visible after its single Save attempt at `16:23:28.371 UTC` was rejected with the stale-version message. No retry; no order creation/deletion; no other field changed. The original `/orders` and unfinished `/new` tabs remained untouched. Production was not accessed.

## Fix for cancelled and completed order edits

The QA failure exposed two gaps: the detail page offered Edit for terminal orders, and a direct authenticated update could change transaction fields after cancellation/completion. The PR follow-up:

- Hides Edit and unmounts an open editor when an order is completed or cancelled.
- Disables and guards the modal save path for terminal orders.
- Adds a database trigger that rejects changes to terminal transaction details while allowing audited status changes, soft deletion/restoration metadata, and SMS delivery metadata.
- Adds backend regression assertions for completed/cancelled rows and verifies that editing works again after an Owner reopens the order.

The migration preserves the more specific existing error for terminal inventory edits by running after that guard. It is applied to Production; Staging remains unchanged because its migration history is separately drifted.

The two-tab result also exposed a client-side verification gap: the Edit modal boundary key included `updated_at`, so a realtime update could remount the modal and discard an in-progress draft. The follow-up removes that version from the key, captures the opening `updated_at`, and refuses to save when the transaction prop has advanced. Both the plain update and multi-service RPC use that captured token. The latest browser QA confirmed the stale draft remained visible and the save was rejected.

## Local verification on the follow-up PR source

- `node tests/backend/test.mjs`: 74 PASS, 0 FAIL. The suite does not run multi-session contention, Supabase API/Realtime transport, or external n8n export.
- `npm run check:migrations`: passed with 49 migration files after adding the unapplied advisor-hardening migration.
- `npx oxlint`: exit 0, 39 warnings (same baseline).
- `npx tsc -b`: exit 0.
- `npm run build`: passed; Vite transformed 133 modules. The un-elevated sandbox attempt hit Windows `spawn EPERM`; the elevated local rerun passed.
- Supabase Production advisors reported existing security/performance findings. The new `transaction_service_items.created_by` foreign key has no covering index; review whether to add one before release. Other advisor results include pre-existing project findings and unused fresh indexes.

After applying `300500`, a fresh `supabase db advisors --type all --level warn` scan returned ten warnings: mutable search path on `private.is_drop_off_service`; authenticated execution of six existing `SECURITY DEFINER` RPCs (`record_expense`, `record_inventory_movement`, `redeem_loyalty_reward`, `set_transaction_status`, `soft_delete_transaction`, `void_expense`); leaked-password protection disabled; and multiple permissive policies on `discounts_promos` and `profiles`. Source review found explicit Owner/Staff permission checks and `PUBLIC`/`anon` execute revocations for the six RPCs; they grant `authenticated` intentionally as guarded app endpoints. The policy overlaps provide Owner management plus active-user or safe-self access. The drop-off helper is `SECURITY INVOKER` and only calls built-in string functions, so its mutable-path warning is a hardening opportunity rather than an identified privilege bypass. The leaked-password setting is the remaining actionable Auth configuration finding. None names the new terminal-edit trigger/function.

## Release gates still open

1. Obtain an authorized Staff session for Staff/Pay Later checks.
2. Run mobile layout and receipt/print checks with browser capabilities that support viewport sizing and print preview.
3. Configure approved disposable Staging inventory fixtures before stock UI tests; do not consume or alter real stock.
4. Reconcile the remaining remote-only migration-history entries with committed migration sources and a documented rollout procedure.
5. Enable/review leaked-password protection in Production Auth settings. Review and apply migration `300600` through the same explicit, project-specific rollout process if the advisor cleanup is desired.
6. Promote only after the above gates pass, then smoke-test the exact production deployment.
