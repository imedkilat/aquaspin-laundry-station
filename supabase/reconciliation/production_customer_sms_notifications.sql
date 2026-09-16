-- REFERENCE ONLY — DO NOT APPLY DIRECTLY.
-- Reconstructed from read-only production inspection on Sep 16, 2026.
-- Captures the structural effect of production migration
-- 20260916024806_customer_sms_notifications.

alter table public.transactions
  add column if not exists sms_sent_at timestamptz,
  add column if not exists sms_sent_by uuid references public.profiles(id),
  add column if not exists sms_message_id text;

-- Production currently has no SMS-specific index on public.transactions.
-- Authenticated retains ordinary table/column UPDATE privilege on these fields,
-- but this audit trigger rejects authenticated attempts to mutate SMS status.
create or replace function public.enforce_transaction_audit_fields()
returns trigger
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'Transaction id cannot be changed' using errcode = '42501';
  end if;

  if new.transaction_no is distinct from old.transaction_no then
    raise exception 'Internal transaction number cannot be changed' using errcode = '42501';
  end if;

  if new.transaction_code is distinct from old.transaction_code then
    raise exception 'Public transaction code cannot be changed' using errcode = '42501';
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'Transaction creator cannot be changed' using errcode = '42501';
  end if;

  if new.created_at is distinct from old.created_at then
    raise exception 'Transaction creation time cannot be changed' using errcode = '42501';
  end if;

  if new.client_request_id is distinct from old.client_request_id then
    raise exception 'Transaction request id cannot be changed' using errcode = '42501';
  end if;

  if auth.uid() is not null and (
    new.sms_sent_at is distinct from old.sms_sent_at
    or new.sms_sent_by is distinct from old.sms_sent_by
    or new.sms_message_id is distinct from old.sms_message_id
  ) then
    raise exception 'SMS status can only be set by the notify-customer function' using errcode = '42501';
  end if;

  if old.deleted_at is null and new.deleted_at is null then
    new.deleted_by := null;
    new.delete_reason := null;
    return new;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    if nullif(btrim(new.delete_reason), '') is null
       or char_length(btrim(new.delete_reason)) < 3 then
      raise exception 'A delete reason of at least 3 characters is required';
    end if;

    new.deleted_at := now();
    new.deleted_by := auth.uid();
    return new;
  end if;

  if old.deleted_at is not null and new.deleted_at is not null then
    raise exception 'Deleted transactions must be restored before editing' using errcode = '42501';
  end if;

  if old.deleted_at is not null and new.deleted_at is null then
    if auth.uid() is not null and not private.is_owner() then
      raise exception 'Only an owner can restore a deleted transaction' using errcode = '42501';
    end if;

    new.deleted_by := null;
    new.delete_reason := null;
    return new;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_transaction_audit_fields() from public, anon, authenticated;
