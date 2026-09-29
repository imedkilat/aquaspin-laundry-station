begin;

create or replace function public.set_transaction_status(
  p_transaction_id uuid, p_status text, p_expected_updated_at timestamptz,
  p_reason text default null, p_override boolean default false
)
returns public.transactions language plpgsql security definer set search_path = ''
as $$
declare
  t public.transactions%rowtype;
  floor_status text;
  source_status text;
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
  if p_status = 'completed'
     and private.is_drop_off_service(t.service_code_snapshot)
     and not exists (
       select 1
       from public.transaction_customer_items i
       where i.transaction_id = t.id and i.quantity > 0
     ) then
    raise exception 'Please record the customer''s item list before completing this order.' using errcode = '23514';
  end if;
  -- NEW: block completing a still-unpaid Pay Later order, override or not.
  if p_status = 'completed' and t.payment_method = 'pay_later' then
    raise exception 'Change the payment method from Pay Later to Cash or GCash before completing this order.' using errcode = '23514';
  end if;
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
      source_status := t.order_status;
      if t.order_status = 'on_hold' then
        select h.previous_status into floor_status
        from public.transaction_status_history h
        where h.transaction_id = t.id and h.new_status = 'on_hold'
        order by h.changed_at desc, h.id desc limit 1;
        source_status := coalesce(floor_status, t.order_status);
      end if;
      source_rank := case source_status
        when 'received' then 1 when 'washing' then 2 when 'drying' then 3
        when 'ready_for_pickup' then 4 when 'completed' then 5 else 0 end;
      destination_rank := case p_status
        when 'received' then 1 when 'washing' then 2 when 'drying' then 3
        when 'ready_for_pickup' then 4 when 'completed' then 5 else 0 end;
      if destination_rank < source_rank then
        raise exception 'Backward movement requires an owner override' using errcode = '42501';
      end if;
      -- Incidental fix to a pre-existing dead branch: normal_next was unassigned,
      -- so the comparison below always compared against NULL. This is separate
      -- from the Pay Later completion guardrail.
      normal_next := case source_status
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

commit;
