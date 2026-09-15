-- Soft-delete with a mandatory reason, so staff can delete a transaction
-- from the dashboard while the owner keeps a full accountability trail --
-- who deleted it, when, and why. A real SQL DELETE stays owner-only
-- (transactions_delete_owner_only, unchanged) as a separate, rarely-used
-- escape hatch; the app's own Delete button only ever does this soft
-- delete (an UPDATE), which the existing transactions_update_staff policy
-- already allows any signed-in staff/owner to do -- no RLS change needed.

alter table public.transactions
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id),
  add column if not exists delete_reason text;

create index if not exists transactions_deleted_at_idx on public.transactions (deleted_at);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_delete_reason_required_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_delete_reason_required_check
      check (
        deleted_at is null
        or (delete_reason is not null and char_length(btrim(delete_reason)) > 0 and char_length(delete_reason) <= 500)
      ) not valid;
  end if;
end
$$;
