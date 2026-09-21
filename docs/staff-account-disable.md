# Staff account Disable / Enable

Staff accounts are **disabled, never deleted**. A Staff profile is referenced (NO ACTION foreign keys) by
transactions, status history, customer items, inventory, expenses and other records, so deleting the login
either fails or would orphan history. Disabling keeps every row and removes every permission.

## Two independent layers

1. **Supabase Auth** – the `manage-staff-user` Edge Function bans the login (`ban_duration`), and
   `public.set_staff_account_active()` deletes the user's `auth.sessions` (cascading to refresh tokens).
2. **Profiles / RLS** – `profiles.is_active`. `private.is_active_user()`, `private.is_owner()`,
   `private.has_staff_permission()`, `private.can_view_transaction()` and every policy that previously checked only
   "a JWT exists" or "a profile row exists" now require an **active** profile row. An unexpired JWT of a disabled
   (or profile-less) user therefore reads and writes nothing.

## Call order (fail closed)

- **Disable:** database disable + session revoke → Auth ban → second session sweep. If the Auth ban fails the app
  access is already gone; the UI reports it and offers *Retry sign-in block* (idempotent).
- **Enable:** Auth unban → database enable. If the database step fails the account stays disabled in the app.

## Rules

- Only an **active Owner** can call the function; the target must be a Staff profile. Owner accounts (including the
  acting Owner) cannot be disabled, enabled, edited or deleted through it – also enforced by
  `profiles_owner_always_active` (CHECK) and inside the RPC.
- Clients cannot write `is_active`, `disabled_at` or `disabled_by` (column-level UPDATE grants + trigger). The RPC is
  executable by `service_role` only.
- All Staff edits, including name-only, go through `manage-staff-user`. Password: 8 characters minimum, 72 bytes
  maximum, enforced in both Edge Functions and in the browser forms.
- Resetting a Staff password also signs that user out everywhere (`public.revoke_staff_sessions`, service role only).
- The signed-in app re-checks its own profile every 60 seconds and when the tab becomes visible; a disabled or
  profile-less account is signed out with a notice on the login page.

## Deploy order

1. Apply migration `20260929010000_staff_account_disable.sql` (adds columns; no existing rows change).
2. Deploy `manage-staff-user` and `create-staff-user`.
3. Deploy the web app.

Deploying the functions before the migration makes the Owner check fail (`is_active` column missing).

## Not verified against a hosted Supabase project

The migration deletes from `auth.sessions` / `auth.refresh_tokens` using the migration owner (`postgres`). The test
database uses shims shaped like GoTrue's tables; confirm on a **non-production** project that the role can delete from
those tables and that a revoked refresh token is rejected, before applying to production.

## Known remaining gaps

- **Owner demote-then-disable.** An Owner can still demote another Owner with the existing *Demote to Staff*
  control (direct `profiles.role` update). A demoted account is Staff and can then be disabled. Protecting this needs a
  product decision (e.g. route role changes through a service-role function that refuses to demote Owners).
- **Existence oracle.** `soft_delete_transaction`, `set_transaction_status` and `save_transaction_customer_items` still
  begin with a "profile row exists" check. A disabled user is still denied by the permission helper right after, but for
  a soft-deleted transaction UUID they can get an "already deleted" error first. No data is returned.
- `private.calculate_loyalty_balance()` (definer, granted to `authenticated`) does not check the caller. It is only
  reachable through the RLS-gated `customer_loyalty_balance` view as long as the `private` schema is not exposed.
- `handle_new_user` gives every new `auth.users` row an active Staff profile. Confirm public sign-ups are disabled in the
  Supabase Auth settings.
- No rate limit or audit log on `manage-staff-user` (only `disabled_at` / `disabled_by` are recorded).
- Concurrent behaviour (the last-Owner lock) is not exercised by the single-connection test database.
