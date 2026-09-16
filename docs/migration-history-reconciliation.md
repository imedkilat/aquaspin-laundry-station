# Migration history reconciliation

## Purpose

Aquaspin production currently has a valid working schema, but the repository migration filenames and Supabase production migration ledger are not in one-to-one sync. This document records the observed drift and the safe path to reconcile it without replaying historical DDL blindly against production.

**Production project:** `yhckdhidchxsypfeyzxj`

**Staging project used for hosted rehearsal:** `wmubrkhgncrtwdlsusea`

**Safety rule:** do not run `supabase db push` against production until the production migration ledger is deliberately reconciled. Repository normalization alone does not make the remote history safe to replay.

## Repository normalization in this branch

Two repository migrations shared the same Supabase version prefix `20260916`, and one dependency was therefore ambiguous on a clean rebuild. This branch changes filenames only:

- `20260916_add_gcash_reference.sql` → `20260916012000_add_gcash_reference.sql`
- `20260916_enable_services_realtime.sql` → `20260916014000_enable_services_realtime.sql`

The SQL bodies are unchanged.

The resulting required order is:

1. `20260916010000_add_ons_catalog_and_profile_repair.sql`
2. `20260916012000_add_gcash_reference.sql`
3. `20260916013000_transaction_codes_and_test_cleanup.sql`
4. `20260916014000_enable_services_realtime.sql`

`transaction_codes_and_test_cleanup` reads `gcash_reference`, so the GCash migration must precede it.

A repository guard is also added at `scripts/check-migrations.mjs` and exposed as:

```bash
npm run check:migrations
```

It fails on duplicate migration versions and on the known GCash → transaction-code dependency inversion.

## Production migration ledger observed on Sep 16, 2026

The live Supabase ledger currently contains:

| Production version | Production name | Repository relationship |
| --- | --- | --- |
| `20260915` | `add_service_pricing_rules` | Direct repository counterpart exists. |
| `20260915174106` | `transaction_payment_integrity_checks` | Repository counterpart exists under `20260917010000_...`. |
| `20260915180704` | `remove_owner_test_transactions` | Production-only historical cleanup; effect is historical/data-specific. |
| `20260915181029` | `security_hardening_pass` | Repository counterpart exists under `20260917020000_...`. |
| `20260915181129` | `index_transactions_updated_by` | Effect is already represented by the repository security-hardening migration. |
| `20260915190757` | `add_transaction_pickup_time` | Repository counterpart exists under `20260918010000_...`. |
| `20260915191400` | `realtime_business_guardrails` | Repository counterpart exists under `20260918020000_...`. |
| `20260915191412` | `validate_business_guardrail_checks` | Production-only validation step. Current live guardrail checks are validated where expected. |
| `20260915192554` | `transaction_edit_delete_audit` | Repository counterpart exists under `20260919010000_...`. |
| `20260915192604` | `validate_delete_reason_check` | Production-only validation step; live delete-reason check is validated. |
| `20260916` | `enable_services_realtime` | Repository counterpart is normalized here to `20260916014000_...`. |
| `20260916015627` | `transaction_snapshot_and_audit_hardening` | Repository counterpart exists under `20260919020000_...`. |
| `20260916024806` | `customer_sms_notifications` | Production-only schema drift. Live schema contains nullable `sms_sent_at`, `sms_sent_by`, `sms_message_id` plus SMS audit protection. PR #3 staging rehearsal reproduced this structural drift. |
| `20260916031013` | `owner_settings_and_staff_permissions` | Repository counterpart exists under `20260920010000_...`. |
| `20260916032655` | `fix_staff_soft_delete_rls` | Production-only historical drift. Live production still exposes the legacy soft-delete overload that PR #3 deliberately removes. |
| `20260916125702` | `shop_branding_and_user_profiles` | Repository counterpart exists under `20260920020000_...`. |

## Repository changes already present live without matching production ledger versions

The repository also contains historical migrations whose schema effects are present in production but whose current repository version identifiers are not recorded one-to-one in the production migration ledger:

- `20260916010000_add_ons_catalog_and_profile_repair.sql`
- `20260916012000_add_gcash_reference.sql` (normalized in this branch)
- `20260916013000_transaction_codes_and_test_cleanup.sql`
- several later repository migrations whose production equivalents were recorded under earlier timestamps shown above

This is why a blind `db push` is unsafe even when the SQL itself is largely idempotent.

## Live validation state relevant to reconciliation

Read-only production inspection on Sep 16 confirmed:

- `transactions_gcash_reference_required_check` exists and is intentionally `NOT VALID` for historical compatibility while still enforcing new/updated rows.
- Cash/GCash payment-integrity checks exist and remain `NOT VALID` for historical compatibility.
- business-guardrail length/ceiling checks that received production validation migrations are validated.
- `transactions_delete_reason_required_check` is validated.
- SMS audit columns and foreign key are present in production.
- Owner/staff settings and branding/profile schema are present.

## Safe reconciliation plan

### Gate A — repository hygiene (this PR)

- [x] Remove duplicate migration version prefix.
- [x] Put GCash schema before transaction-code backfill by filename order.
- [x] Add an automated migration-version/dependency guard.
- [x] Document production ↔ repository drift.
- [ ] Run the guard and normal build/lint on this branch.

### Gate B — capture remote-only history in code

Before production migration-history repair, capture the production-only structural migrations in repository form, especially:

1. `customer_sms_notifications`
2. the historical `fix_staff_soft_delete_rls` contract needed to explain the existing legacy RPC
3. validation/index steps where the current live state is materially different from a clean repository rebuild

These should be forward/reconstructive historical files or an approved canonical baseline strategy; do not invent no-op marker files that cannot rebuild a fresh database.

### Gate C — clean rebuild proof

From an empty isolated Supabase database, apply the canonical migration set in filename order and verify:

- schema/RLS/RPC state
- Storage policies/buckets
- Realtime publication membership
- Cash/GCash/Pay Later constraints
- audit/snapshot protections
- Owner/Staff permissions
- PR #3 customer/status migrations
- generated TypeScript types
- Supabase security/performance advisors

The Sep 16 hosted staging rehearsal proved the current schema can be reconstructed when the actual dependency order and live drift are supplied; this gate must be repeated from the final canonical migration files before declaring history reconciled.

### Gate D — production migration ledger repair

Only after schema equivalence is proven should production migration tracking be changed. Use `supabase migration list` to inspect the exact local/remote delta, then use `supabase migration repair --status applied <version>` only for versions whose schema effects have been independently verified as already present.

`migration repair` changes tracking state only; it does not execute DDL. Never mark a migration applied merely to silence a sync error.

Remote-only historical versions should remain represented locally or otherwise be reconciled through an approved baseline strategy so future `migration list`/`db push` operations remain deterministic.

### Gate E — production deployment

After the ledger and repository agree:

1. dry-run / inspect pending migrations;
2. apply only the intended new customer/status migrations;
3. verify migration ledger;
4. verify RPC signatures/grants/RLS;
5. run authenticated Owner/Staff smoke tests;
6. run two-session concurrency and Realtime checks;
7. only then treat `db push` as a supported deployment path again.

## Current production rule

Until Gates B–D are complete:

> **Do not use blind `supabase db push` against Aquaspin production.**

Use reviewed, explicitly scoped migrations and preserve the existing production schema/data until the migration ledger is reconciled.
