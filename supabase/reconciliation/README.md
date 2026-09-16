# Production migration drift snapshots

This directory contains **reference-only SQL snapshots** reconstructed from read-only inspection of the live Aquaspin production database on Sep 16, 2026.

These files are **not** part of `supabase/migrations/` and are **not automatically executed** by Supabase CLI.

They exist so the repository records the structural effects of production-only migration history before we decide how to fold those effects into the final canonical migration chain.

## Files

- `production_customer_sms_notifications.sql`
  - live nullable `transactions.sms_sent_at`
  - live nullable `transactions.sms_sent_by` → `profiles(id)` foreign key
  - live nullable `transactions.sms_message_id`
  - current production `enforce_transaction_audit_fields()` SMS-protection behavior
  - no SMS-specific transaction index exists in production
  - authenticated currently has table/column UPDATE privilege on the three SMS fields, but the audit trigger rejects authenticated changes; PR #3 later tightens this further with column-level revocation

- `production_fix_staff_soft_delete_rls.sql`
  - current live legacy `soft_delete_transaction(uuid,text,timestamptz)` function shape
  - authenticated EXECUTE granted
  - anon/public EXECUTE denied
  - this legacy overload is intentionally removed by PR #3 in favor of the hardened `soft_delete_transaction(uuid,timestamptz,text)` contract

## Rule

Do not copy these files into `supabase/migrations/` or apply them to production/staging without a separate reviewed migration plan. Their purpose is evidence capture and dependency design for migration-history reconciliation.
