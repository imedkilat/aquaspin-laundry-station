-- OPTIONAL OWNER-REVIEWED BACKFILL. Not part of automatic schema installation.
-- Run during a maintenance window after reviewing source rows.
-- Default is a dry run: change the final ROLLBACK to COMMIT only after approval.
begin;
set local lock_timeout = '5s';
-- Prevent concurrent customer creation/edits and transaction edits while matching.
lock table public.customers, public.transactions in share row exclusive mode;
do $$
begin
  if auth.uid() is not null and not private.is_owner() then
    raise exception 'Owner required' using errcode = '42501';
  end if;
end;
$$;

-- Include deleted transactions in ambiguity detection, but never mutate them.
create temporary table customer_backfill_groups on commit drop as
select public.normalize_customer_phone(phone_number) phone,
  min(btrim(customer_name)) full_name,
  count(distinct btrim(customer_name)) names
from public.transactions
where public.normalize_customer_phone(phone_number) is not null
group by public.normalize_customer_phone(phone_number);

insert into public.customers (full_name, phone_number)
select g.full_name, g.phone from customer_backfill_groups g
where g.names = 1 and char_length(g.full_name) between 1 and 120
  and exists (select 1 from public.transactions t where t.deleted_at is null and t.customer_id is null
    and public.normalize_customer_phone(t.phone_number) = g.phone)
  and not exists (select 1 from public.customers c where c.normalized_phone = g.phone);

create temporary table customer_backfill_links on commit drop as
with unique_customers as (
  select normalized_phone, (array_agg(id))[1] id from public.customers
  where normalized_phone is not null group by normalized_phone having count(*) = 1
)
select t.id transaction_id, c.id customer_id
from public.transactions t
join customer_backfill_groups g on g.phone = public.normalize_customer_phone(t.phone_number) and g.names = 1
join unique_customers u on u.normalized_phone = g.phone
join public.customers c on c.id = u.id and c.active and btrim(c.full_name) = g.full_name
where t.customer_id is null and t.deleted_at is null and btrim(t.customer_name) = g.full_name;

update public.transactions t set customer_id = l.customer_id
from customer_backfill_links l where t.id = l.transaction_id and t.customer_id is null;

select (select count(*) from customer_backfill_links) as safely_linked_this_run,
  (select count(*) from public.transactions where customer_id is null) as left_unlinked,
  (select count(*) from customer_backfill_groups g where g.names > 1
    or (select count(*) from public.customers c where c.normalized_phone = g.phone) > 1
    or exists (select 1 from public.customers c where c.normalized_phone = g.phone and btrim(c.full_name) <> g.full_name))
    as ambiguous_phone_groups;
rollback;
