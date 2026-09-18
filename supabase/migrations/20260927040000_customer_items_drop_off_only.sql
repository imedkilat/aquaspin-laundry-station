-- Customer clothing items apply only to Drop Off services.
-- Self-Service orders may complete without an item list.
begin;
set local lock_timeout = '5s';

create or replace function private.is_drop_off_service(p_service_code text)
returns boolean
language sql
immutable
as $$
  select upper(btrim(coalesce(p_service_code, ''))) in ('CSDB', 'LWB', 'PWDF', 'WDF');
$$;

revoke all on function private.is_drop_off_service(text) from public, anon, authenticated;
grant execute on function private.is_drop_off_service(text) to authenticated;

create or replace function private.stamp_transaction_customer_item()
returns trigger
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  transaction_status text;
  service_code text;
  target_transaction_id uuid;
begin
  target_transaction_id := case when tg_op = 'DELETE' then old.transaction_id else new.transaction_id end;

  select order_status, service_code_snapshot
    into transaction_status, service_code
  from public.transactions
  where id = target_transaction_id
  for share;

  if not found then
    raise exception 'Transaction not available' using errcode = '42501';
  end if;
  if transaction_status in ('completed', 'cancelled') then
    raise exception 'Completed and cancelled orders have immutable customer item lists' using errcode = '42501';
  end if;
  if not private.is_drop_off_service(service_code) then
    raise exception 'Customer item lists are only applicable to Drop Off services' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Authentication and shop profile required' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and (new.transaction_id, new.item_type, new.created_at, new.created_by)
      is distinct from (old.transaction_id, old.item_type, old.created_at, old.created_by) then
    raise exception 'Customer item identity and creation metadata are immutable' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_at := clock_timestamp();
    new.created_by := auth.uid();
  end if;
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end;
$$;

revoke all on function private.stamp_transaction_customer_item() from public, anon, authenticated;

create or replace function public.save_transaction_customer_items(
  p_transaction_id uuid,
  p_items jsonb
)
returns setof public.transaction_customer_items
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  transaction_status text;
  service_code text;
  item record;
  item_types text[] := array[]::text[];
  item_count integer := 0;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Authentication and shop profile required' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Customer item list must be an array' using errcode = '22023';
  end if;

  select order_status, service_code_snapshot
    into transaction_status, service_code
  from public.transactions
  where id = p_transaction_id
    and private.can_view_transaction(transaction_date, payment_method, deleted_at)
  for update;

  if not found then
    raise exception 'Transaction not available for editing' using errcode = '42501';
  end if;
  if not private.has_staff_permission('edit_transactions') then
    raise exception 'Transaction item editing is disabled by the Owner' using errcode = '42501';
  end if;
  if not private.is_drop_off_service(service_code) then
    raise exception 'Customer item lists are only applicable to Drop Off services' using errcode = '42501';
  end if;
  if transaction_status not in ('received', 'washing', 'drying', 'ready_for_pickup') then
    raise exception 'Customer item lists can only be edited before completion' using errcode = '42501';
  end if;

  for item in
    select item_type, quantity, custom_item_name
    from jsonb_to_recordset(p_items) as input(item_type text, quantity integer, custom_item_name text)
  loop
    item_count := item_count + 1;
    if item.item_type is null or item.item_type not in ('shorts', 't_shirts', 'pants', 'underwear', 'dresses', 'towels', 'bedsheets', 'jackets', 'other') then
      raise exception 'Unsupported customer item type' using errcode = '22023';
    end if;
    if item.quantity is null or item.quantity <= 0 then
      raise exception 'Customer item quantities must be whole numbers greater than zero' using errcode = '22023';
    end if;
    if item.item_type = 'other' and nullif(btrim(item.custom_item_name), '') is null then
      raise exception 'Other requires a custom item name' using errcode = '22023';
    end if;
    if item.item_type <> 'other' and item.custom_item_name is not null then
      raise exception 'Custom item names are only allowed for Other' using errcode = '22023';
    end if;
    if item.item_type = any(item_types) then
      raise exception 'Duplicate customer item types are not allowed' using errcode = '22023';
    end if;
    item_types := array_append(item_types, item.item_type);
  end loop;

  if item_count = 0 then
    raise exception 'At least one customer item with a positive quantity is required' using errcode = '22023';
  end if;

  delete from public.transaction_customer_items
  where transaction_id = p_transaction_id
    and not (item_type = any(item_types));

  for item in
    select item_type, quantity, custom_item_name
    from jsonb_to_recordset(p_items) as input(item_type text, quantity integer, custom_item_name text)
  loop
    update public.transaction_customer_items
    set quantity = item.quantity,
        custom_item_name = case when item.item_type = 'other' then btrim(item.custom_item_name) else null end,
        updated_by = auth.uid()
    where transaction_customer_items.transaction_id = p_transaction_id
      and transaction_customer_items.item_type = item.item_type;

    if not found then
      insert into public.transaction_customer_items (transaction_id, item_type, quantity, custom_item_name, created_by, updated_by)
      values (p_transaction_id, item.item_type, item.quantity,
        case when item.item_type = 'other' then btrim(item.custom_item_name) else null end,
        auth.uid(), auth.uid());
    end if;
  end loop;

  return query
    select *
    from public.transaction_customer_items
    where transaction_id = p_transaction_id
    order by item_type;
end;
$$;

revoke all on function public.save_transaction_customer_items(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_transaction_customer_items(uuid, jsonb) to authenticated;

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
