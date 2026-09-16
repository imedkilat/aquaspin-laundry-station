-- "Notify customer" SMS: lets staff/owner tell a customer their laundry is
-- ready for pickup with one click, via the Semaphore SMS API. Sending
-- happens server-side (notify-customer-sms Edge Function, service-role
-- key) so the Semaphore API key is never exposed to the browser.
--
-- The sent/last-sent-by columns are audit trail, same spirit as
-- deleted_at/deleted_by: recorded here so the owner can see who notified
-- a customer and when, and locked to the Edge Function only so a staff
-- client can't fake "already sent" by hand.

alter table public.transactions
  add column if not exists sms_sent_at timestamptz,
  add column if not exists sms_sent_by uuid references public.profiles(id),
  add column if not exists sms_message_id text;

comment on column public.transactions.sms_sent_at is 'When the "ready for pickup" SMS was last sent to the customer. Set only by the notify-customer-sms Edge Function.';
comment on column public.transactions.sms_sent_by is 'Staff/owner profile who triggered the last SMS send.';
comment on column public.transactions.sms_message_id is 'Semaphore message id for the last send, kept for support/debugging.';

-- Lock the SMS audit columns down to the service role. A regular
-- authenticated client (auth.uid() is not null) can never set these
-- directly -- only the Edge Function's service-role client can, which
-- runs with auth.uid() = null, matching the existing restore-by-owner
-- exemption in enforce_transaction_audit_fields().
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

  -- Normal active row: deletion metadata cannot be pre-filled/spoofed.
  if old.deleted_at is null and new.deleted_at is null then
    new.deleted_by := null;
    new.delete_reason := null;
    return new;
  end if;

  -- First transition into soft-deleted state. Timestamp + actor are generated
  -- by Postgres, not trusted from the browser.
  if old.deleted_at is null and new.deleted_at is not null then
    if nullif(btrim(new.delete_reason), '') is null
       or char_length(btrim(new.delete_reason)) < 3 then
      raise exception 'A delete reason of at least 3 characters is required';
    end if;

    new.deleted_at := now();
    new.deleted_by := auth.uid();
    return new;
  end if;

  -- Deleted rows are immutable until an owner restores them. This keeps the
  -- audit trail meaningful even if a staff member bypasses the UI.
  if old.deleted_at is not null and new.deleted_at is not null then
    raise exception 'Deleted transactions must be restored before editing' using errcode = '42501';
  end if;

  -- Restore transition: owner-only at the database layer. Service-role/admin
  -- maintenance has auth.uid() = null and remains possible when necessary.
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
