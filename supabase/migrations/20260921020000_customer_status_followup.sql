-- Follow-up hardening for customer/status backend.
-- This migration is additive/forward-only and belongs after
-- 20260921010000_customer_status_backend.sql.
begin;
set local lock_timeout = '5s';

-- Customer lifecycle is more sensitive than ordinary directory edits.
create function private.guard_customer_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.active is false)
     or (tg_op = 'UPDATE' and new.active is distinct from old.active) then
    if auth.uid() is null or not private.is_owner() then
      raise exception 'Only an owner can deactivate or reactivate a customer' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_customer_lifecycle() from public, anon, authenticated;
create trigger customers_owner_lifecycle
  before insert or update of active on public.customers
  for each row execute function private.guard_customer_lifecycle();

create function public.soft_delete_transaction(
  p_transaction_id uuid,
  p_expected_updated_at timestamptz,
  p_delete_reason text
)
returns table(success boolean, transaction_id uuid, updated_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare t public.transactions%rowtype;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Authentication and shop profile required' using errcode = '42501';
  end if;
  if p_transaction_id is null or p_expected_updated_at is null then
    raise exception 'Transaction id and expected updated_at are required' using errcode = '22023';
  end if;
  if p_delete_reason is null or char_length(btrim(p_delete_reason)) < 3 or char_length(p_delete_reason) > 500 then
    raise exception 'A delete reason between 3 and 500 characters is required' using errcode = '22023';
  end if;
  select * into t from public.transactions where id = p_transaction_id for update;
  if not found then raise exception 'Transaction not available' using errcode = '42501'; end if;
  if t.deleted_at is not null then raise exception 'Transaction is already deleted' using errcode = '22023'; end if;
  if not private.can_view_transaction(t.transaction_date, t.payment_method, t.deleted_at) then
    raise exception 'Transaction not available' using errcode = '42501';
  end if;
  if not private.has_staff_permission('delete_transactions') then
    raise exception 'Transaction deletion is disabled by the Owner' using errcode = '42501';
  end if;
  if t.updated_at is distinct from p_expected_updated_at then
    raise exception 'Transaction changed; reload before deleting' using errcode = '40001';
  end if;
  update public.transactions as tx
    set deleted_at = clock_timestamp(), deleted_by = auth.uid(), delete_reason = btrim(p_delete_reason)
  where tx.id = t.id and tx.deleted_at is null and tx.updated_at = p_expected_updated_at;
  if not found then raise exception 'Transaction changed; reload before deleting' using errcode = '40001'; end if;
  return query select true, t.id, x.updated_at from public.transactions x where x.id = t.id;
end;
$$;
revoke all on function public.soft_delete_transaction(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.soft_delete_transaction(uuid, timestamptz, text) to authenticated;

drop view public.customer_summary;
create view public.customer_summary with (security_invoker = true) as
select c.id as customer_id, c.customer_code, count(t.id) as total_transactions,
  coalesce(sum(t.total_amount), 0) as total_billed,
  coalesce(sum(least(t.total_amount, coalesce(t.cash_amount, 0) + coalesce(t.gcash_amount, 0))), 0) as total_collected,
  coalesce(sum(greatest(t.total_amount - least(t.total_amount, coalesce(t.cash_amount, 0) + coalesce(t.gcash_amount, 0)), 0)), 0) as outstanding_balance,
  max(t.transaction_date) as last_visit
from public.customers c
left join public.transactions t on t.customer_id = c.id and t.deleted_at is null
group by c.id, c.customer_code;
revoke all on public.customer_summary from public, anon, authenticated;
grant select on public.customer_summary to authenticated;

create or replace function public.set_transaction_status(
  p_transaction_id uuid, p_status text, p_expected_updated_at timestamptz,
  p_reason text default null, p_override boolean default false
)
returns public.transactions language plpgsql security definer set search_path = ''
as $$
declare
  t public.transactions%rowtype;
  floor_status text;
  source_rank integer;
  destination_rank integer;
  normal_next text;
  prior_reason text := current_setting('aquaspin.status_reason', true);
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Authentication and shop profile required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('received','washing','drying','ready_for_pickup','completed','on_hold','cancelled') then
    raise exception 'Invalid order status' using errcode = '22023';
  end if;
  if p_expected_updated_at is null or p_override is null then
    raise exception 'Expected updated_at and explicit override flag required' using errcode = '22023';
  end if;
  if char_length(p_reason) > 500 then raise exception 'Reason exceeds 500 characters' using errcode = '22023'; end if;
  select * into t from public.transactions where id = p_transaction_id for update;
  if not found then raise exception 'Transaction not available' using errcode = '42501'; end if;
  if not private.can_view_transaction(t.transaction_date, t.payment_method, t.deleted_at)
     or not private.has_staff_permission('edit_transactions') then
    raise exception 'Transaction not available for editing' using errcode = '42501';
  end if;
  if t.deleted_at is not null then raise exception 'Restore transaction before changing status' using errcode = '42501'; end if;
  if t.updated_at is distinct from p_expected_updated_at then
    raise exception 'Transaction changed; reload before retrying' using errcode = '40001';
  end if;
  if t.order_status = p_status then raise exception 'Order already has this status' using errcode = '22023'; end if;
  if p_override then
    if not private.is_owner() or nullif(btrim(p_reason), '') is null then
      raise exception 'Owner override requires a reason' using errcode = '42501';
    end if;
  else
    if t.order_status in ('completed','cancelled') then
      raise exception 'Terminal order requires an owner override' using errcode = '42501';
    end if;
    if p_status in ('on_hold','cancelled') then
      if nullif(btrim(p_reason), '') is null then raise exception 'Hold and cancellation require a reason' using errcode = '22023'; end if;
    else
      select h.previous_status into floor_status
      from public.transaction_status_history h
      where h.transaction_id = t.id and h.new_status = 'on_hold'
      order by h.changed_at desc, h.id desc limit 1;
      source_rank := case coalesce(floor_status, t.order_status)
        when 'received' then 1 when 'washing' then 2 when 'drying' then 3
        when 'ready_for_pickup' then 4 when 'completed' then 5 else 0 end;
      destination_rank := case p_status
        when 'received' then 1 when 'washing' then 2 when 'drying' then 3
        when 'ready_for_pickup' then 4 when 'completed' then 5 else 0 end;
      if destination_rank < source_rank then
        raise exception 'Backward movement requires an owner override' using errcode = '42501';
      end if;
      normal_next := case coalesce(floor_status, t.order_status)
        when 'received' then 'washing' when 'washing' then 'drying'
        when 'drying' then 'ready_for_pickup' when 'ready_for_pickup' then 'completed' end;
      if destination_rank > source_rank + 1 or t.order_status = 'on_hold' then
        if nullif(btrim(p_reason), '') is null then raise exception 'Forward skips and hold resumes require a reason' using errcode = '22023'; end if;
      elsif p_status <> normal_next then
        raise exception 'Invalid operational transition' using errcode = '22023';
      end if;
    end if;
  end if;
  perform set_config('aquaspin.status_reason', coalesce(p_reason, ''), true);
  update public.transactions set order_status = p_status where id = t.id returning * into t;
  perform set_config('aquaspin.status_reason', coalesce(prior_reason, ''), true);
  return t;
end;
$$;
revoke all on function public.set_transaction_status(uuid, text, timestamptz, text, boolean) from public, anon, authenticated;
grant execute on function public.set_transaction_status(uuid, text, timestamptz, text, boolean) to authenticated;

do $$
begin
  if not has_function_privilege('authenticated', 'private.has_staff_permission(text)', 'EXECUTE') then
    raise exception 'Authenticated permission helper EXECUTE must be preserved';
  end if;
end;
$$;
commit;
