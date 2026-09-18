-- Automatically link new transactions to canonical customer records.
-- If the intake does not select an existing customer, resolve by normalized
-- phone number or create a new customer profile in the same transaction.
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

  -- Customer-directory management remains a separate Owner/Staff setting.
  -- Existing customers can still be linked by phone when directory creation
  -- is disabled; new profiles are created only when this permission is active.
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

drop trigger if exists transactions_00_resolve_customer on public.transactions;
create trigger transactions_00_resolve_customer
before insert on public.transactions
for each row execute function private.resolve_transaction_customer();

commit;
