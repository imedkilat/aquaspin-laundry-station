-- Terminal orders may only be reopened or soft-deleted through their audited
-- RPCs. Their customer, service, payment, and other transaction details must
-- remain immutable even for direct authenticated API updates.

create or replace function private.prevent_terminal_transaction_edit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  lifecycle_columns text[] := array[
    'order_status',
    'updated_at',
    'updated_by',
    'deleted_at',
    'deleted_by',
    'delete_reason',
    'sms_sent_at',
    'sms_sent_by',
    'sms_message_id'
  ];
begin
  if old.order_status in ('completed', 'cancelled')
     and (to_jsonb(new) - lifecycle_columns) is distinct from (to_jsonb(old) - lifecycle_columns) then
    raise exception 'Completed and cancelled orders cannot be edited. Reopen the order first.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_terminal_transaction_edit() from public, anon, authenticated;

create trigger transactions_09_prevent_terminal_edits
  before update on public.transactions
  for each row execute function private.prevent_terminal_transaction_edit();
