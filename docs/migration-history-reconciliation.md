# Migration history reconciliation

## Purpose

Aquaspin production has a working schema, but its historical Supabase migration ledger had drifted away from the repository: several repo migrations used different timestamps, two legacy migrations used short `YYYYMMDD` versions, some production-only migrations were missing locally, and the base schema lived outside the migration chain.

This branch makes the repository history reproducible and maps it back to the production ledger without changing production.

**Production project:** `yhckdhidchxsypfeyzxj`

**Staging project used for hosted rehearsal:** `wmubrkhgncrtwdlsusea`

**Safety rule:** do not run blind `supabase db push` against production until the remaining production-ledger reconciliation gate is explicitly approved.

## Canonical repository history

### Versioned base

`supabase/schema.sql` was previously not part of the executable migration chain. This branch adds:

- `20260914000000_base_schema.sql`

The file byte-matches `supabase/schema.sql`, so profiles, services, transactions, initial RLS/Auth trigger, and initial Realtime membership can now be reconstructed from versioned migration code.

### Early untracked historical setup

Four schema stages already exist in production but are not recorded there under these canonical local IDs:

1. `20260914000000_base_schema.sql`
2. `20260915160000_add_ons_catalog_and_profile_repair.sql`
3. `20260915161000_add_gcash_reference.sql`
4. `20260915162000_transaction_codes_and_test_cleanup.sql`

The GCash migration is intentionally before transaction-code backfill because that backfill reads/enforces `gcash_reference`.

### Production-ledger versions restored locally

The repository now contains local migrations matching every version currently recorded in the production ledger:

- `20260915_add_service_pricing_rules.sql`
- `20260915174106_transaction_payment_integrity_checks.sql`
- `20260915180704_remove_owner_test_transactions.sql`
- `20260915181029_security_hardening_pass.sql`
- `20260915181129_index_transactions_updated_by.sql`
- `20260915190757_add_transaction_pickup_time.sql`
- `20260915191400_realtime_business_guardrails.sql`
- `20260915191412_validate_business_guardrail_checks.sql`
- `20260915192554_transaction_edit_delete_audit.sql`
- `20260915192604_validate_delete_reason_check.sql`
- `20260916_enable_services_realtime.sql`
- `20260916015627_transaction_snapshot_and_audit_hardening.sql`
- `20260916024806_customer_sms_notifications.sql`
- `20260916031013_owner_settings_and_staff_permissions.sql`
- `20260916032655_fix_staff_soft_delete_rls.sql`
- `20260916125702_shop_branding_and_user_profiles.sql`

Where production had split cleanup/index/validation/SMS/legacy soft-delete history, the original statements were recovered read-only from `supabase_migrations.schema_migrations` instead of being guessed.

The reference snapshots under `supabase/reconciliation/` remain non-executable historical evidence. The canonical executable copies are now represented under `supabase/migrations/`.

## Migration guard

`scripts/check-migrations.mjs` is run by `prebuild` and checks:

- migration filenames use `YYYYMMDD` or `YYYYMMDDHHMMSS` numeric versions;
- legacy day-only versions are normalized to midnight for chronological comparisons (`YYYYMMDD` → `YYYYMMDD000000`);
- no raw or normalized version collisions exist;
- `20260914000000_base_schema.sql` is the first migration;
- the base migration byte-matches `supabase/schema.sql`;
- GCash schema precedes transaction-code cleanup/backfill;
- all 16 exact production-ledger versions remain represented locally.

The final version-normalization fix is commit `8e599c105b9d0f172a6efa0322f897935a04cf3b`.

An independent execution of the guard against the exact branch migration set passed:

`Migration history check passed (20 migration files, unique normalized versions, canonical base present, production ledger represented).`

The exact final commit did not receive a normal Vercel build because the Hobby project hit Vercel's build-rate limit. That Vercel status is a platform-quota failure, not a migration-guard or application-build failure. Earlier branch heads proved the `prebuild` hook and normal TypeScript/Vite build path work; do not label `8e599c1...` itself Vercel-READY until Vercel actually rebuilds it.

## Hosted staging clean app-schema rebuild — Sep 16, 2026

A controlled reconstruction was performed only on **Aquaspin Staging** (`wmubrkhgncrtwdlsusea`). Production was not modified.

### Reset boundary

Before reset, staging contained 8 Aquaspin public tables, 2 synthetic Auth users, 2 Aquaspin Storage buckets, 0 Storage objects, 8 Aquaspin Storage policies, and the expected Realtime memberships.

The reset deliberately preserved:

- Supabase platform schemas;
- the 2 synthetic staging Auth users;
- the two empty Storage bucket rows, because Supabase protects direct deletion from Storage tables.

It removed/recreated the Aquaspin application schema, views, functions, private schema, RLS policies, Storage policies, and Realtime membership state. The branding/profile migration then exercised the bucket definitions idempotently through `INSERT ... ON CONFLICT UPDATE` and recreated all 8 Storage policies.

Therefore this is a **clean Aquaspin application-schema rebuild**, not a claim that the entire hosted Supabase project was physically recreated from zero.

### Historical chain result

PASS: all canonical historical SQL stages applied in chronological order from the versioned base through branding/profile with no SQL failure:

- base schema
- service pricing
- add-ons/profile repair
- GCash reference
- transaction codes/test cleanup
- payment integrity
- historical QA cleanup
- security hardening + historical updated-by index
- pickup time
- business guardrails + validation
- transaction delete audit + validation
- services Realtime
- transaction snapshot/audit hardening
- SMS audit fields
- Owner settings/staff permissions
- legacy Staff soft-delete RPC
- branding/profile/Storage policy hardening

Historical baseline verification after reconstruction:

- 6 core pre-PR3 public tables;
- 2 synthetic profiles and 4 seeded services;
- 2 Aquaspin Storage buckets and 8 expected Storage policies;
- Realtime membership for transactions, services, add-ons, and shop settings;
- authenticated EXECUTE preserved for `private.has_staff_permission(text)`;
- legacy `soft_delete_transaction(uuid,text,timestamptz)` present before PR #3, as expected.

## PR #3 reconstruction on top of the clean baseline

The already-reviewed PR #3 customer/status sequence was then replayed on top of the newly reconstructed historical baseline:

1. customer/status foundation;
2. follow-up hardening;
3. live-drift reconciliation;
4. customer/status RLS initplan performance hardening.

All stages applied with no SQL failure.

Final hosted staging structure verifies:

- public tables: `add_ons_catalog`, `customers`, `profiles`, `rate_limit_hits`, `services`, `shop_settings`, `transaction_status_history`, `transactions`;
- Realtime membership includes customers and transaction status history in addition to the historical four tables;
- `customer_summary` and `customer_transaction_history` are `security_invoker=true` views;
- `customer_summary` exposes `total_transactions`, `total_billed`, `total_collected`, `outstanding_balance`, and `last_visit`;
- authenticated retains EXECUTE on `private.has_staff_permission(text)`;
- legacy `soft_delete_transaction(uuid,text,timestamptz)` is absent;
- hardened `soft_delete_transaction(uuid,timestamptz,text)` exists, is executable by `authenticated`, and is not executable by `anon`;
- authenticated direct UPDATE is denied for `transactions.order_status` and SMS audit fields;
- the 3 customer RLS policies and status-history policy use `(select auth.uid())` initplan form.

### Rollback-only authenticated regression checks

A controlled Staff/Owner transaction was created inside a transaction and rolled back afterward.

PASS:

- Staff hardened soft-delete RPC returned success;
- Staff could no longer SELECT the soft-deleted transaction afterward;
- Owner retained visibility of the deleted audit row;
- no QA row remained after rollback.

A second rollback-only lifecycle test also passed:

- Staff `received → drying` forward skip succeeded with a reason;
- Staff backward `drying → washing` was rejected;
- no QA row remained after rollback.

These directly cover the backend Staff-delete failure observed during Phase 1 browser QA. The Phase 1 frontend still needs to call the hardened RPC contract after the backend branch is integrated; do not work around the RLS rule in the browser.

## Advisor state after reconstruction

### Security advisor

No new schema-security blocker was introduced. Remaining findings are understood:

- `rate_limit_hits` has RLS enabled and intentionally no client policy because clients must not access it directly;
- `set_transaction_status` and `soft_delete_transaction` are intentionally authenticated `SECURITY DEFINER` RPCs with explicit authorization/concurrency checks;
- leaked-password protection is a staging Auth project setting.

### Performance advisor

The four customer/status `auth_rls_initplan` warnings are gone after the final RLS hardening migration.

Remaining non-blocking optimization notices include three historical foreign keys without covering indexes (`shop_settings.updated_by`, `transactions.deleted_by`, `transactions.sms_sent_by`), expected unused-index notices on a freshly rebuilt low-data staging database, and the existing pair of permissive profile UPDATE policies (`profiles_update_owner_only` + `profiles_update_self_safe`). These are separate optimization work, not a reason to weaken current authorization behavior.

## Remaining gate before production ledger repair

The repository history and hosted app-schema reconstruction are now materially aligned. Production is still intentionally untouched.

Before any production migration-history write:

1. inspect the exact local ↔ remote migration delta with Supabase CLI when available;
2. verify that the four canonical historical IDs not currently recorded in production correspond only to effects independently confirmed already present;
3. prepare the minimal `migration repair --status applied` plan for only those proven historical IDs;
4. do not mark any version applied merely to silence a mismatch;
5. re-run migration list/dry-run and confirm the only genuinely pending migrations are the intended new customer/status migrations;
6. obtain an explicit production gate before changing the production migration ledger or applying PR #3.

## Current production rule

> **Do not run blind `supabase db push` against Aquaspin production.**

No production migration, migration-history record, production data, or production deployment was changed by this reconciliation rehearsal.
