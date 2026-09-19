-- Allow multiple named customer items that are not in the standard dropdown.
-- Existing standard rows and legacy "other" rows remain compatible.
begin;
set local lock_timeout = '5s';

alter table public.transaction_customer_items
  drop constraint if exists transaction_customer_items_type_check,
  drop constraint if exists transaction_customer_items_custom_name_check,
  drop constraint if exists transaction_customer_items_unique_type;

alter table public.transaction_customer_items
  add constraint transaction_customer_items_type_check check (
    item_type in ('shorts', 't_shirts', 'pants', 'underwear', 'dresses', 'towels', 'bedsheets', 'jackets', 'other', 'custom')
  ),
  add constraint transaction_customer_items_custom_name_check check (
    (item_type in ('other', 'custom') and custom_item_name is not null and char_length(btrim(custom_item_name)) between 1 and 120)
    or (item_type not in ('other', 'custom') and custom_item_name is null)
  );

create unique index if not exists transaction_customer_items_standard_type_unique_idx
  on public.transaction_customer_items (transaction_id, item_type)
  where item_type <> 'custom';

create unique index if not exists transaction_customer_items_named_item_unique_idx
  on public.transaction_customer_items (transaction_id, lower(btrim(custom_item_name)))
  where item_type in ('other', 'custom');

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
  item_names text[] := array[]::text[];
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
    if item.item_type is null or item.item_type not in ('shorts', 't_shirts', 'pants', 'underwear', 'dresses', 'towels', 'bedsheets', 'jackets', 'other', 'custom') then
      raise exception 'Unsupported customer item type' using errcode = '22023';
    end if;
    if item.quantity is null or item.quantity <= 0 then
      raise exception 'Customer item quantities must be whole numbers greater than zero' using errcode = '22023';
    end if;
    if item.item_type in ('other', 'custom') and nullif(btrim(item.custom_item_name), '') is null then
      raise exception 'Custom items require a name' using errcode = '22023';
    end if;
    if item.item_type not in ('other', 'custom') and item.custom_item_name is not null then
      raise exception 'Custom item names are only allowed for named items' using errcode = '22023';
    end if;
    if item.item_type <> 'custom' and item.item_type = any(item_types) then
      raise exception 'Duplicate customer item types are not allowed' using errcode = '22023';
    end if;
    if item.item_type <> 'custom' then
      item_types := array_append(item_types, item.item_type);
    end if;
    if item.item_type in ('other', 'custom') then
      if lower(btrim(item.custom_item_name)) = any(item_names) then
        raise exception 'Duplicate custom item names are not allowed' using errcode = '22023';
      end if;
      item_names := array_append(item_names, lower(btrim(item.custom_item_name)));
    end if;
  end loop;

  if item_count = 0 then
    raise exception 'At least one customer item with a positive quantity is required' using errcode = '22023';
  end if;

  delete from public.transaction_customer_items
  where transaction_id = p_transaction_id
    and not (
      item_type = any(item_types)
      or (item_type = 'custom' and lower(btrim(custom_item_name)) = any(item_names))
    );

  for item in
    select item_type, quantity, custom_item_name
    from jsonb_to_recordset(p_items) as input(item_type text, quantity integer, custom_item_name text)
  loop
    if item.item_type = 'custom' then
      update public.transaction_customer_items
      set quantity = item.quantity,
          custom_item_name = btrim(item.custom_item_name),
          updated_by = auth.uid()
      where transaction_customer_items.transaction_id = p_transaction_id
        and transaction_customer_items.item_type = 'custom'
        and lower(btrim(transaction_customer_items.custom_item_name)) = lower(btrim(item.custom_item_name));
    else
      update public.transaction_customer_items
      set quantity = item.quantity,
          custom_item_name = case when item.item_type = 'other' then btrim(item.custom_item_name) else null end,
          updated_by = auth.uid()
      where transaction_customer_items.transaction_id = p_transaction_id
        and transaction_customer_items.item_type = item.item_type;
    end if;

    if not found then
      insert into public.transaction_customer_items (transaction_id, item_type, quantity, custom_item_name, created_by, updated_by)
      values (p_transaction_id, item.item_type, item.quantity,
        case when item.item_type in ('other', 'custom') then btrim(item.custom_item_name) else null end,
        auth.uid(), auth.uid());
    end if;
  end loop;

  return query
    select *
    from public.transaction_customer_items
    where transaction_id = p_transaction_id
    order by item_type, lower(custom_item_name), id;
end;
$$;

revoke all on function public.save_transaction_customer_items(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_transaction_customer_items(uuid, jsonb) to authenticated;

commit;
