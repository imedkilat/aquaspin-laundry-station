-- Forward-only correction for the customer auto-link trigger.
-- The original variable name conflicted with the generated column name.
begin;

create or replace function private.resolve_transaction_customer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_normalized_phone text;
  v_matched_customer_id uuid;
begin
  if new.customer_id is not null then
    return new;
  end if;

  v_normalized_phone := public.normalize_customer_phone(new.phone_number);

  if v_normalized_phone is not null then
    select c.id
      into v_matched_customer_id
    from public.customers c
    where c.normalized_phone = v_normalized_phone
      and c.active
    order by c.created_at, c.id
    limit 1;

    if v_matched_customer_id is not null then
      new.customer_id := v_matched_customer_id;
      return new;
    end if;
  end if;

  if not private.has_staff_permission('manage_customers') then
    return new;
  end if;

  insert into public.customers (full_name, phone_number, active)
  values (
    btrim(new.customer_name),
    nullif(btrim(new.phone_number), ''),
    true
  )
  returning id into new.customer_id;

  return new;
end;
$$;

revoke all on function private.resolve_transaction_customer() from public, anon, authenticated;

commit;
