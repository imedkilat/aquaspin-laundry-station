# PR #29 Production Readiness

**Status as of 2026-09-26: DO NOT PROMOTE THE APPLICATION YET.** Migrations `300300`, `300400`, and `300500` have been applied to Production and verified. A follow-up advisor-hardening migration (`300600`) is prepared locally but has not been applied to either database. The cancelled-order edit and stale multi-tab save fixes passed browser QA on preview commit `9bc3ec50aeb2b4a9caaef063a269afe6cbc79c5a`. Staff, mobile, inventory behavior, and older migration-history reconciliation remain open. Receipt/printer fit verification is parked until the production printer is selected; it is not a current release gate by project-owner decision. Leaked-password protection is explicitly excluded from release gates because the project is not on Supabase Pro and there is no plan to upgrade.

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

### Follow-up read-only ledger/source audit (2026-09-26)

An exact project-scoped Supabase migration-list read returned 68 Production history rows and 43 Staging rows. Compared with the 49 local migration files:

| Project | Exact version matches | Remote versions absent locally | Local versions absent remotely |
| --- | ---: | ---: | ---: |
| Production (`yhckdhidchxsypfeyzxj`) | 48 | 20 | `20260930060000` only |
| Staging (`wmubrkhgncrtwdlsusea`) | 2 (`300300`, `300400`) | 41 | 47 |

For Production, the 20 remote-only versions are not 20 unknown SQL bodies. I read only their recorded migration statements and compared them with the local migration files: 16 are byte-for-byte matches under a different version/name mapping, and two more have identical non-comment SQL with only comment/blank-line differences. The remaining two are historical variants, not safe aliases:

- `20260918004506 loyalty_points_v1` differs from local `20260926010000_loyalty_points_v1.sql`: the remote historical statement lacks the later `GRANT EXECUTE` for `private.calculate_loyalty_balance(uuid)`.
- `20260918183514 customer_items_drop_off_only` differs in its status-transition validation from local `20260927040000_customer_items_drop_off_only.sql`.

Both canonical later migration versions are also recorded in Production. This audit does not establish that the two older variants can be discarded or repaired; it establishes the exact source differences and that names alone are insufficient. Production already records PR #29 migrations `300300`, `300400`, and `300500`; `300600` is the sole local migration version not recorded there and remains optional/unapplied. No migration, repair, or database write was run.

Staging remains a separate reconciliation problem: only `300300` and `300400` match by exact version, and its 41 other remote rows plus 47 local-only versions mean this migration directory must not be used for a blind Staging `migration up` either. No single shared local migration list currently mirrors both remote ledgers. The next database step is a reviewed, project-specific deployment workflow; this source audit is not an approval to change either ledger.

## Latest Staging browser QA

### Follow-up supplied 2026-09-26 (stable alias at `b6dcb9f487e20d7480eb8d222495e2438f9854e0`)

The stable alias was READY at deployment `2026-09-25T17:16:02.152Z`. Its loaded asset returned HTTP 200, pointed to Staging (`wmubrkhgncrtwdlsusea`), and did not contain Production (`yhckdhidchxsypfeyzxj`). The app bundle matched the READY `e14d387` bundle; `dc7b5e9` and `b6dcb9f` were documentation-only commits. Production was not accessed.

| Check | Result | Evidence |
| --- | --- | --- |
| Staff permissions / Pay Later | Blocked | Owner session only; no Staff account was created or simulated. |
| Mobile 320px / 375px | Blocked | Browser did not expose viewport/device emulation. |
| Cancelled / Completed Edit list guard | Pass | At `b6dcb9f`, `AQ-4002F39B` (Cancelled) and `AQ-FF83DC66` (Completed) had no Edit action in the Orders list. Earlier cancelled-order check also covered Dashboard. |
| Inventory categories / selectors | Pass | On the READY `dc7b5e9` deployment, exact `Liquid Detergent` and `Fabric Conditioner` categories made the QA items appear in their expected selectors. |
| Insufficient-stock completion | Pass, one attempt | `AQ-37C67A11` remained Ready for Pickup after a single completion attempt; UI showed available `0.000`, required `1.000` for `QA-PR29-LIQUID-ZERO-20260925T1707Z`. No retry. |
| Successful consumption | Pass | `AQ-EF064936` reached Completed and consumed 1 ml from the QA conditioner fixture, leaving 999 ml from the recorded 1,000 ml stock-in. |
| Receipt | Parked | Receipt fit/print styling remains deferred until the production printer and paper size are selected. |

Screenshots supplied: `pr29-latest-cancelled-list-1790356681879.jpg`, `pr29-latest-completed-list-1790356688245.jpg`, `pr29-zero-stock-rejection-final-1790356710071.jpg`, `pr29-success-consumption-completed-1790356457943.jpg`, and `pr29-inventory-final-value-1790356867477.jpg`.

QA-only Staging data remaining includes categories `Liquid Detergent`, `Fabric Conditioner`, and `QA-PR29-Consumables-20260926T0026PH`; items `QA-PR29-LIQUID-ZERO-20260925T1707Z` (0 ml), `QA-PR29-CONDITIONER-STOCK-20260925T1707Z` (999 ml), `QA-PR29-CONSUME-20260926T0026PH` (2 pcs), and `QA-PR29-ZERO-STOCK-20260926T0026PH` (0 pcs). Synthetic order `AQ-37C67A11` is Ready for Pickup after its rejected completion; `AQ-EF064936` is Completed. Both have QA customer-item entries. No cleanup was performed.

A separate subsequent browser run on the same stable alias attempted two more synthetic order submissions but could not find a matching order or confirm stock movement. The attempts were not retried; request IDs/statuses were unavailable. This is an **inconclusive repeat-submission result**, separate from the screenshot-backed passes above, and should be resolved before calling inventory order submission fully repeat-verified. In that run only the two existing QA items' category assignments were changed; quantities remained 0 pcs and 2 pcs. No existing non-QA order changed. The original `/orders` and unfinished `/new` tabs were left untouched.

### Earlier follow-up supplied 2026-09-26 (preview commit `90a1d72e9b4f863687107a1a07c8026027f2c022`)

The stable alias was READY at deployment `dpl_4rTE5UTVbU2xW4EdhfgzbKETk476`. The loaded asset pointed to Staging (`wmubrkhgncrtwdlsusea`) and did not contain the Production ref. An Owner session was available. Production, migrations, deployment promotion, and merge were not accessed or performed.

| Check | Result | Evidence |
| --- | --- | --- |
| Staff permissions and Pay Later | Blocked | Owner session only; no Staff account was created or simulated. |
| Mobile 320px / 375px | Blocked | Browser capability list had no viewport/device emulation. |
| Receipt order details | Pass | `AQ-4C9FB66C`: WDF 8kg/1 load ₱195, Comforter/Special Item 1kg/1 load ₱220, total ₱415, GCash ₱415, reference `QA-PR29-20260925T151016Z`. |
| Rendered receipt / print | Parked | Defer rendered print and paper-fit verification until the production printer is selected. |
| Inventory fixture setup | Pass | Created a generic category `QA-PR29-Consumables-20260926T0026PH`, a zero-stock item, and a second item with +2 pcs QA-only stock. No order was created and no stock was consumed. |
| Inventory items in New Order | Retest required | The form filters detergent and conditioner items by category names `Liquid Detergent` and `Fabric Conditioner`; both QA items were placed under the generic `QA-PR29-Consumables…` category. This does not establish a product defect. Recreate fixtures under the two expected category names, then verify the correct item appears in each selector. |
| Insufficient stock / successful consumption | Blocked | No eligible selector item appeared, so no order was created and no stock was consumed. |
| Cancelled guard in Dashboard table | UI gap found | `AQ-4002F39B` remained Cancelled. The Dashboard exposed Edit; the modal opened with Save Changes disabled and was canceled without saving. The detail page had previously hidden Edit. A client-side transaction-table guard is now added locally with regression coverage; the existing database trigger remains the authoritative safeguard. |

No Production request, migration, deployment, or merge occurred. The original `/orders` and unfinished `/new` tabs were left untouched. No non-QA order or field changed. The QA-created category and two inventory items remain in Staging, with the consumption item at 2 pcs and the zero-stock item at 0 pcs.

### Prior browser results

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
- `npm run test:receipt`: 5 PASS, 0 FAIL. The unit tests cover multi-service receipt rows/grand total, add-ons and GCash/Pay Later labels, HTML escaping, and print CSS/trigger; a rendered print-preview check remains open.
- GitHub Actions CI now runs `test:receipt` alongside the backend, customer-item, sales-metrics, and staff-account suites.
- `npm run check:migrations`: passed with 49 migration files after adding the unapplied advisor-hardening migration.
- `npx oxlint`: exit 0, 39 warnings (same baseline).
- `npx tsc -b`: exit 0.
- `npm run build`: passed; Vite transformed 133 modules. The un-elevated sandbox attempt hit Windows `spawn EPERM`; the elevated local rerun passed.
- Follow-up local verification after the Dashboard terminal-edit guard: backend 74/74, receipt 5/5, customer-item 8/8, sales-metrics 12/12, staff-account 5/5, and transaction-edit 3/3 passed. `npx oxlint` passed with the existing 39-warning baseline; `npx tsc -b`, `npm run build` (134 modules), and `git diff --check` passed. On this Windows sandbox, Node's `--test` worker mode returned `spawn EPERM`; the same Node test files passed when invoked directly. Build passed with elevated process permission.
- Supabase Production advisors reported existing security/performance findings. The new `transaction_service_items.created_by` foreign key has no covering index; review whether to add one before release. Other advisor results include pre-existing project findings and unused fresh indexes.

After applying `300500`, a fresh `supabase db advisors --type all --level warn` scan returned ten warnings: mutable search path on `private.is_drop_off_service`; authenticated execution of six existing `SECURITY DEFINER` RPCs (`record_expense`, `record_inventory_movement`, `redeem_loyalty_reward`, `set_transaction_status`, `soft_delete_transaction`, `void_expense`); leaked-password protection disabled; and multiple permissive policies on `discounts_promos` and `profiles`. Source review found explicit Owner/Staff permission checks and `PUBLIC`/`anon` execute revocations for the six RPCs; they grant `authenticated` intentionally as guarded app endpoints. The policy overlaps provide Owner management plus active-user or safe-self access. The drop-off helper is `SECURITY INVOKER` and only calls built-in string functions, so its mutable-path warning is a hardening opportunity rather than an identified privilege bypass. Per the project owner's decision, leaked-password protection is excluded from release gates because it requires Supabase Pro and there is no plan to upgrade. None of these findings names the new terminal-edit trigger/function.

## Release gates still open

1. Obtain an authorized Staff session for Staff/Pay Later checks.
2. Run mobile layout checks at 320px and 375px with a browser that supports viewport sizing.
3. Resolve the inconclusive repeat-submission attempt; the earlier selector, zero-stock rejection, and 1 ml successful-consumption checks passed with named QA records. Do not retry any unconfirmed submission unless the browser can first establish whether a prior write succeeded.
4. Reconcile the remaining remote-only migration-history entries with committed migration sources and a documented rollout procedure.
5. Decide separately whether the optional `300600` advisor hardening is needed before release; do not apply it without a project-specific rollout plan and authorization.
6. Promote only after the above gates pass, then smoke-test the exact production deployment.

## Deferred verification

- Receipt paper size, scaling, and rendered print layout are parked until the production printer is selected. Reopen this check after the printer model and paper size are known.
