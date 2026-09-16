# Customer and order-status backend

Review-only backend foundation based on `43133661056b357a0950cd4fdf08b6d3bc34c7a9`.
No production database connection, data mutation, deployment, or merge is part of this change.
Frontend PR #1 (`feat/phase1-core-operations-shell`) remains separate.

## Follow-up delta in PR #3

The follow-up migration `20260921020000_customer_status_followup.sql` fixes the baseline
staff soft-delete UX without weakening RLS. `soft_delete_transaction(uuid,timestamptz,text)`
checks employee profile, visibility, delete permission, active state, reason, and the
existing `updated_at` token, then atomically soft-deletes and returns only `{success,
transaction_id, updated_at}`. It never returns the hidden receipt. Owners and permitted
staff use this RPC; Owner restore behavior remains unchanged.

`customer_summary` now exposes `total_transactions`, `total_billed`, `total_collected`,
`outstanding_balance`, and `last_visit`. Collected is
`least(total_amount, cash_amount + gcash_amount)` and outstanding is billed minus that
amount, clamped at zero. Cash change cannot inflate revenue. Deleted receipts remain
excluded and the view remains security-invoker.

Operational status transitions now allow permitted staff to skip forward to any later
operational stage with a reason. The normal adjacent step remains reason-free. Backward
movement, terminal reopen, and explicit owner override remain Owner-only with a reason;
hold, cancel, and hold-resume require reasons. Status values and ledger immutability are
unchanged, and service IDs/codes are not embedded in the rules.

Customer `active` changes are Owner-only. Staff may still create/edit customer details
when `staff_can_manage_customers` is enabled, but cannot deactivate or reactivate records.
History and snapshots remain intact.

## Architecture audit before implementation

Read `supabase/schema.sql`, all 13 tracked baseline migrations, transaction types,
the create/edit forms, transaction Realtime hook, settings context, and export Edge Function.
The audit is of repository main, **not a live-schema attestation**.

| Existing migration | Existing responsibility |
| --- | --- |
| `20260915_add_service_pricing_rules.sql` | Service pricing type and 8 kg/load capacity |
| `20260916_add_gcash_reference.sql` | Reference field, uniqueness and conditional requirement |
| `20260916_enable_services_realtime.sql` | Service publication |
| `20260916010000_add_ons_catalog_and_profile_repair.sql` | Add-on catalog and JSON receipt snapshots |
| `20260916013000_transaction_codes_and_test_cleanup.sql` | Random AQ codes; exact historic QA-row cleanup |
| `20260917010000_transaction_payment_integrity_checks.sql` | Cash coverage and GCash amount constraints |
| `20260917020000_security_hardening_pass.sql` | Anonymous grants, catalog policies, transaction updated_by |
| `20260918010000_add_transaction_pickup_time.sql` | Optional pickup time |
| `20260918020000_realtime_business_guardrails.sql` | Idempotency, caps, rate limiter |
| `20260919010000_transaction_edit_delete_audit.sql` | Soft-delete attribution and reason |
| `20260919020000_transaction_snapshot_and_audit_hardening.sql` | Historical add-on pricing; immutable receipt identity; restore guard |
| `20260920010000_owner_settings_and_staff_permissions.sql` | Settings-based transaction visibility, edits, deletion, intake rules |
| `20260920020000_shop_branding_and_user_profiles.sql` | Branding, account profile fields, authenticated permission-helper grant |

There was no canonical customer table, customer RPC, customer migration, operational
status column or status ledger. `profiles` contains **employees**, not customers.
Existing transactions retain `customer_name`, `phone_number`, commercial amounts,
add-on JSON snapshots, public AQ identity, payment values, and creator/editor/deletion
metadata. There is no general append-only transaction edit ledger in this baseline;
the existing audit protections are triggers plus metadata. Service labels are joined
from the current catalog; this PR does not claim or introduce a service-label snapshot.

The edit form uses `UPDATE ... WHERE id = ... AND updated_at = ...`, detecting zero
rows as a stale edit. New status RPC uses that same token, with a row lock before
checking it. Ordinary edits must continue to supply this filter; this PR does not
make arbitrary direct transaction edits enforce a browser token automatically.

Staff see today's active transactions; historical access depends on dashboard/full
history settings plus the historical Pay Later switch. Deleted receipts are owner-only.
Transaction UPDATE RLS admits edit/delete permissions, and triggers distinguish the
operation. Owner restores remain protected. No employee table or profile policy changes.

Historic filenames have mixed timestamp widths: the AQ-code migration references
`gcash_reference` from a lexicographically later filename. The local harness explicitly
loads the GCash migration first. Do not replay historic migrations on production or
rename already-applied files. Compare the real migration ledger before installation.

## Customer contract

`customers` stores canonical identity; `transactions.customer_id` is nullable and never
replaces either receipt snapshot field. New receipts may link an active customer while
supplying transaction-time name/phone. Updating/deactivating a customer does not touch
receipts. A later customer correction does not change past receipts. Relinking receipts
uses normal transaction edit permissions and should use the existing `updated_at` filter.

Customer codes use `CUS-` plus 16 random hexadecimal characters, protected by a unique
constraint. They are display identifiers, not authentication secrets. The database UUID
remains an internal relational key. A rare unique violation should prompt an insert retry;
the database never merges identities to resolve a collision.

`normalize_customer_phone(text)` recognizes Philippine mobile numbers in `09…`, `639…`
and `+639…` forms, tolerating whitespace, parentheses, dots and hyphens. Unsupported
formats return NULL; the original phone remains stored. Lookup:

```sql
select * from public.customers
where normalized_phone = public.normalize_customer_phone('09171234567');
```

The normalized-phone index is **not unique**. Return all matches and let the operator
choose; shared phones are supported. Inactive customers remain readable but cannot be
newly attached to a transaction. Customers have no client DELETE privilege or policy.

Owners manage all customers. Staff with an existing employee profile can read the
directory, including inactive entries, for operational lookup. The default-true
`staff_can_manage_customers` setting gates staff INSERT/UPDATE of normal customer details;
the lifecycle trigger reserves active/inactive changes for Owners.
It does not grant transaction visibility or editing. Customer notes are visible to staff
who can read the directory; do not store owner-only information there. The frontend
toggle is deferred; owners can configure the setting through the existing settings API.

The `customer_summary` security-invoker view returns:

- `total_transactions`: number of linked, nondeleted, caller-visible receipts (visits).
- `total_billed`: sum of billed `total_amount`, including unpaid charges.
- `total_collected`: sum of `least(total_amount, cash_amount + gcash_amount)`, so cash
  change never counts as revenue.
- `outstanding_balance`: sum of `greatest(total_amount - least(total_amount,
  cash_amount + gcash_amount), 0)` across all payment methods. Fully paid Cash/GCash
  receipts contribute zero; Pay Later and partial payments contribute their balance.
- `last_visit`: maximum `transaction_date` across those receipts, not insertion time.

Operational cancellation does not cancel a financial obligation. Cancelled receipts
remain in totals until an explicit financial correction/soft deletion. No refunds or
settlement state are invented. Staff totals can be partial because transaction RLS is
applied; future screens must label their scope. Owner totals cover all active receipts.
`customer_transaction_history` is also security-invoker; filter by `customer_id`, order
by `transaction_date DESC, id`, and paginate. Owners can see deleted receipts there;
summary totals exclude them. Unlinked legacy receipts are not attributed to a customer.

## Legacy linking

**The schema migration creates zero canonical customers and links zero old receipts.**
All existing rows keep their snapshots and nullable customer link. Production linked,
unlinked and ambiguous counts are NOT RUN, since production was not queried.

`supabase/scripts/backfill_customers.sql` is a separately reviewed administrative
maintenance script, not a public RPC. It defaults to ROLLBACK and reports
`safely_linked_this_run`, `left_unlinked`, and `ambiguous_phone_groups` before rollback.
It needs administrative table-lock privileges; a normal authenticated owner session is
not enough to acquire those locks. The script refuses a non-owner authenticated actor.

Matching rules:

1. Recognized normalized mobile phone only; never name-only.
2. Exactly one trimmed, case-sensitive name across **all** receipts for that phone,
   including deleted receipts used only as ambiguity evidence.
3. Create a customer only when none exists for that phone, the name is valid, and an
   active unlinked receipt exists. Otherwise require exactly one existing customer,
   active, with the exact trimmed name.
4. Duplicate canonical phones, differing names, invalid/missing phone, inactive
   customers, and deleted receipts remain untouched. Existing links are not overwritten.
5. Table locks prevent changes between matching and linking. Linking changes the
   usual edit timestamp/actor; it never rewrites receipt name, phone or amounts.

After examining the dry-run rows and counts, an administrator can explicitly change the
last ROLLBACK to COMMIT in a reviewed copy. Committed reruns do not duplicate customers
or overwrite links. Identity matching is deterministic; newly allocated IDs are random.
Current constraints can reject historically invalid receipts: the whole script rolls
back rather than disabling integrity checks. Run within a maintenance window.

Fixture result: **1 linked, 17 unlinked, 2 ambiguous phone groups**; second committed run
links 0. These counts describe synthetic tests only, not production.

## Order lifecycle and concurrency

Stored values: `received`, `washing`, `drying`, `ready_for_pickup`, `completed`, `on_hold`,
`cancelled`. All legacy receipts, including deleted ones, receive `received` as an
unknown-work baseline, never inferred from payment. The default is a constant column
default and does not update each receipt or change its existing edit token.

| From | Normal destinations | Reason |
| --- | --- | --- |
| received | washing, drying, ready_for_pickup, on_hold, cancelled | Adjacent step needs no reason; forward skips require reason |
| washing | drying, ready_for_pickup, completed, on_hold, cancelled | Adjacent step needs no reason; forward skips require reason |
| drying | ready_for_pickup, completed, on_hold, cancelled | Adjacent step needs no reason; forward skips require reason |
| ready_for_pickup | completed, on_hold, cancelled | Required for hold/cancel |
| on_hold | received, washing, drying, ready_for_pickup, cancelled | Always required |
| completed / cancelled | None without owner override | Owner override always requires reason |

Hold may resume at the held stage or a later operational stage, with a reason. Owners can explicitly override/reopen to any **different**
valid state with a reason, including skipping wash/dry for services that do not use both.
Same-state calls are rejected without adding noise to the ledger. These rules need shop
review, especially self-service wash-only/dry-only orders; no frontend behavior is assumed.

```ts
await supabase.rpc('set_transaction_status', {
  p_transaction_id: transaction.id,
  p_status: 'washing',
  p_expected_updated_at: transaction.updated_at, // preserve full server precision
  p_reason: null,
  p_override: false,
})
```

The RPC requires an authenticated employee, transaction visibility and edit permission,
rejects deleted receipts, locks the row, checks the existing token, validates the
transition, updates status, and appends history atomically through a trigger. A stale
token raises SQLSTATE `40001`: refetch and ask the operator to reassess; never silently
retry with a fresh token. Preserve the raw timestamp string, not a JavaScript Date that
would truncate microseconds. All transaction writes now advance the **same** timestamp
monotonically with `greatest(clock_timestamp(), old.updated_at + 1 microsecond)`.

Authenticated users retain UPDATE privileges for existing columns and customer_id,
but **not order_status**. There is no user-settable security bypass flag. A local GUC
only transports the optional ledger note after RPC authorization; setting it does not
grant status-update permission. The RPC restores its prior value. Trusted database
administrators/service-role integrations must use the RPC with a user identity for
normal changes; their raw elevated SQL remains privileged and can bypass transitions,
but the ledger trigger still records status changes.

Initial history records use NULL previous status. Legacy history says the status was
unknown before migration, with NULL actor and migration-time timestamp. New orders
start received and record the authenticated actor. Changed status records previous/new
value, timestamp, actor and reason. Client INSERT/UPDATE/DELETE/TRUNCATE privileges are
revoked; UPDATE/DELETE also fail through an immutable trigger. A restrictive FK now
prevents hard-deleting transactions with history, including owners. Normal soft-delete
and restore remain the supported paths. Administrators can still disable triggers or
truncate as part of privileged disaster recovery; this is not a tamper-proof external log.

## Security and compatibility details

- Existing `has_staff_permission` cases and its maintenance semantics remain unchanged;
  `manage_customers` is added. EXECUTE is explicitly regranted to authenticated and
  checked in the migration and tests. New endpoints explicitly reject missing auth
  rather than treating the helper's pre-existing NULL-user maintenance branch as login.
- The public status RPC is SECURITY DEFINER because the caller cannot update raw status.
  It uses an empty search_path, fully qualified relations, explicit authorization,
  and authenticated-only EXECUTE. `private.record_transaction_status` is trigger-only
  SECURITY DEFINER for ledger appends, with empty search_path and no client EXECUTE.
  The existing private permission helper retains its pinned path and authorized lookup.
  All other newly added functions are invoker functions. Views use security_invoker.
- Intake/snapshot trigger **functions are unchanged**. Their triggers now distinguish
  INSERT from UPDATE OF relevant input columns. Status-only operations do not reprice
  receipts or require newly mandated phone/pickup/notes. Existing audit and employee
  permission triggers still run. Financial CHECK constraints still run on every UPDATE;
  historical violations need explicit repair before a status change can succeed.
- Existing exports keep their explicit column list and RPC dependency. Existing
  transactions Realtime subscription receives status updates; no subscription is added.
  Customers/history join the existing publication if present. Database writes need no
  Realtime connection. Future customer screens should invalidate/refetch their summaries
  on customer/transaction events and refetch after reconnection.
- Type definitions expose tables, views and RPC without permitting raw status mutations.
  The only runtime frontend change is the new default settings field; no UI redesign.

Current guidance reviewed: [Supabase RLS and grants](https://supabase.com/docs/guides/database/postgres/row-level-security),
[Supabase changelog](https://supabase.com/changelog), and [PGlite](https://pglite.dev/docs/).
New public tables have explicit grants, so they do not depend on default Data API
exposure. Publication membership does not alter the locked-down `realtime` schema.

## Database object inventory

Two new forward migrations: `20260921010000_customer_status_backend.sql` and
`20260921020000_customer_status_followup.sql`. Generated with
Supabase CLI 2.117.0, then sequenced after the baseline's already-future-dated September 20
migrations. No applied migration is edited.

**Tables and columns**

| Table | Added columns |
| --- | --- |
| customers (new) | id uuid; customer_code text; full_name text; phone_number text; normalized_phone generated text; notes text; active boolean; created_at/updated_at timestamptz; created_by/updated_by uuid |
| transaction_status_history (new) | id uuid; transaction_id uuid; previous_status/new_status text; changed_at timestamptz; changed_by uuid; reason text |
| transactions | customer_id nullable uuid; order_status NOT NULL text DEFAULT received |
| shop_settings | staff_can_manage_customers NOT NULL boolean DEFAULT true |

**Constraints** (NOT NULL/defaults are listed in SQL and the column descriptions)

- Customers: `customers_pkey`, `customers_customer_code_key`, `customers_customer_code_check`,
  `customers_full_name_check`, `customers_phone_number_check`, `customers_notes_check`,
  `customers_created_by_fkey`, `customers_updated_by_fkey`.
- Transactions: `transactions_customer_id_fkey` (RESTRICT), `transactions_order_status_check`;
  added NOT VALID then validated in this migration. No old constraints are dropped.
- History: `transaction_status_history_pkey`, `transaction_status_history_transaction_id_fkey`
  (RESTRICT), `transaction_status_history_changed_by_fkey`, `transaction_status_history_previous_check`,
  `transaction_status_history_new_check`, `transaction_status_history_change_check`,
  `transaction_status_history_reason_check`.

**Indexes**

- Automatic PK/unique indexes: `customers_pkey`, `customers_customer_code_key`,
  `transaction_status_history_pkey`.
- `customers_normalized_phone_idx`: partial nonunique phone lookup and duplicate detection.
- `customers_created_by_idx`, `customers_updated_by_idx`: attribution FK access.
- `transactions_customer_date_idx`: partial customer history/date pagination and FK lookup.
- `transactions_active_status_date_idx`: active operational queue by status/date.
- `transaction_status_history_transaction_date_idx`: receipt ledger lookup/latest entries;
  also covers the transaction FK prefix.
- `transaction_status_history_changed_by_idx`: actor FK/audit lookup.
- `transaction_status_history_initial_idx`: unique partial baseline per receipt.
  Existing transaction date/name/payment/service indexes are reused, not duplicated.

**Functions/RPCs**

- New `public.normalize_customer_phone(text)`; authenticated EXECUTE.
- Replaced `private.has_staff_permission(text)`; authenticated EXECUTE preserved.
- New private trigger functions: `stamp_customer()`, `guard_transaction_customer_status()`,
  `advance_transaction_updated_at()`, `record_transaction_status()`,
  `reject_status_history_mutation()`; no PUBLIC/anon/authenticated EXECUTE.
- New `public.set_transaction_status(uuid,text,timestamptz,text,boolean)`;
  authenticated EXECUTE only (plus function owner).
- New `public.soft_delete_transaction(uuid,timestamptz,text)`; authenticated EXECUTE
  only (plus function owner). It returns success metadata, never the deleted row.
- New invoker views: `customer_summary`, `customer_transaction_history`; authenticated SELECT.

**RLS policies**

- `customers_select`: authenticated employee directory reads.
- `customers_insert`: employee and manage_customers permission WITH CHECK.
- `customers_update`: identical permission predicate for USING and WITH CHECK.
- `transaction_status_history_select`: authenticated caller must see the parent receipt.
  No customer DELETE or history write policies. Existing transaction RLS stays unchanged.
- `customers_owner_lifecycle` trigger makes active/inactive changes Owner-only while
  leaving staff detail edits governed by `staff_can_manage_customers`.

**Triggers**

- New `customers_stamp`, `transactions_01_customer_status`, `transactions_record_status`,
  `transaction_status_history_immutable`.
- Rebound `transactions_set_updated_at` to the new monotonic-token trigger function;
  shared `public.set_updated_at()` remains unchanged for other tables.
- Replaced `transactions_10_normalize_add_on_snapshot` with UPDATE OF commercial columns;
  added `transactions_10_normalize_add_on_snapshot_insert` for INSERT.
- Replaced `transactions_12_enforce_shop_preferences` with UPDATE OF intake/commercial/deletion
  columns; added `transactions_12_enforce_shop_preferences_insert` for INSERT.
- `customers_owner_lifecycle`: rejects staff create-as-inactive and staff deactivation/
  reactivation. `soft_delete_transaction` uses existing transaction audit triggers.

## Validation and production gate

Run the self-contained PostgreSQL suite:

```sh
npm ci --prefix tests/backend --ignore-scripts
npm test --prefix tests/backend
```

After installing app dependencies, compile the API contracts without running any client:

```sh
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --skipLibCheck --moduleResolution bundler --module esnext --target es2023 tests/backend/contracts.ts
```

The harness uses in-memory PGlite PostgreSQL and minimal Supabase auth/storage shims.
It executes the full repository baseline plus the new migration and issues SQL as actual
anon/authenticated roles, including realistic Supabase default table grants. It cannot
connect to a live database. It is not a substitute for staging Supabase integration.

See `customer-status-test-results.md` for each PASS/FAIL/NOT RUN result.

Before production approval:

1. Compare actual schema/grants/migration ledger to this base SHA, including any manual
   database changes. Verify Postgres >=15 for security-invoker views. Run Supabase advisors
   in staging; no production advisor or SQL call was made here.
2. Review existing NULL-user helper behavior and staff soft-delete RLS on the real baseline.
   Those are inherited behavior, not new authorization shortcuts in the status RPC.
3. Inventory historical violations of NOT VALID payment/text/amount constraints. A status
   update intentionally cannot circumvent these. Confirm the existing export rate-limit
   RPC's service-role EXECUTE privilege in staging (repository default-grant dependent).
4. Size receipts/history, rehearse lock time and storage overhead, and take a backup.
   Constant status default avoids a receipt-table rewrite, but ALTER TABLE needs locks,
   constraint validation/index creation scan data, and one baseline ledger row is inserted
   per existing receipt. `lock_timeout=5s` fails rather than waiting indefinitely to lock.
   Index builds are transactional and block writers; use a maintenance window. Do not
   blindly retry mid-traffic. Schema migration is atomic, not an idempotent reapply script;
   use the migration ledger. The optional backfill is rerunnable and separately approved.
5. Exercise two real concurrent sessions: status/status, status/edit, edit/status, and
   status/delete. Test API column privileges, RPC timestamp precision and Realtime with
   owner/staff JWTs, disconnection/reconnection, and live publication settings.
6. Approve directory/notes visibility, default staff customer permission, summary billing
   semantics, hold-resume rules, and owner skips for wash-only/dry-only services.
7. Independently review/apply only the new migration. No `db push`, production deployment,
   or auto-merge is authorized by this PR. Keep PR #1 and unrelated local SMS work separate.

Rollback guidance: if migration fails, its transaction rolls back. After successful
installation, prefer a forward fix. Dropping new columns/tables after use would destroy
customer links or lifecycle history; do not use a destructive automatic down migration.
