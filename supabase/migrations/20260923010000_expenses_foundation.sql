-- Phase 4 expense foundation.
-- Expenses are independent operating costs. This migration does not model
-- refunds, settlements, cancelled-order balances, or transaction adjustments.

create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null
    check (char_length(btrim(name)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id)
);

create unique index if not exists expense_categories_name_unique_idx
  on public.expense_categories (lower(name));

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category_id uuid references public.expense_categories(id) on delete set null,
  description text not null
    check (char_length(btrim(description)) between 1 and 160),
  amount numeric(12,2) not null
    check (amount > 0),
  vendor text
    check (vendor is null or char_length(btrim(vendor)) <= 120),
  notes text
    check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  void_reason text
    check (void_reason is null or char_length(btrim(void_reason)) between 3 and 500)
);

create index if not exists expenses_date_idx
  on public.expenses (expense_date desc, created_at desc);

create index if not exists expenses_category_idx
  on public.expenses (category_id);

create or replace function public.set_expense_category_updated_by()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

revoke all on function public.set_expense_category_updated_by() from public, anon, authenticated;

drop trigger if exists expense_categories_set_updated_by on public.expense_categories;
create trigger expense_categories_set_updated_by
  before update on public.expense_categories
  for each row execute function public.set_expense_category_updated_by();

create or replace view public.active_expenses
with (security_invoker = true)
as
select
  e.id,
  e.expense_date,
  e.category_id,
  c.name as category_name,
  e.description,
  e.amount,
  e.vendor,
  e.notes,
  e.created_at,
  e.created_by
from public.expenses e
left join public.expense_categories c on c.id = e.category_id
where e.voided_at is null;

alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;

revoke all on table public.expense_categories from anon, authenticated;
revoke all on table public.expenses from anon, authenticated;
grant select, insert, update on table public.expense_categories to authenticated;
grant select on table public.expenses to authenticated;
grant select on public.active_expenses to authenticated;

drop policy if exists expense_categories_owner_select on public.expense_categories;
create policy expense_categories_owner_select
  on public.expense_categories
  for select
  to authenticated
  using ((select private.is_owner()));

drop policy if exists expense_categories_owner_insert on public.expense_categories;
create policy expense_categories_owner_insert
  on public.expense_categories
  for insert
  to authenticated
  with check ((select private.is_owner()) and created_by = (select auth.uid()));

drop policy if exists expense_categories_owner_update on public.expense_categories;
create policy expense_categories_owner_update
  on public.expense_categories
  for update
  to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

drop policy if exists expenses_owner_select on public.expenses;
create policy expenses_owner_select
  on public.expenses
  for select
  to authenticated
  using ((select private.is_owner()));

create or replace function public.record_expense(
  p_description text,
  p_amount numeric,
  p_expense_date date default current_date,
  p_category_id uuid default null,
  p_vendor text default null,
  p_notes text default null
)
returns public.expenses
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  result public.expenses;
begin
  if auth.uid() is null or not private.is_owner() then
    raise exception 'Only an owner can record expenses' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_description, '')), '') is null then
    raise exception 'Expense description is required';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Expense amount must be greater than zero';
  end if;

  if p_category_id is not null
     and not exists (
       select 1
       from public.expense_categories
       where id = p_category_id
     ) then
    raise exception 'Expense category not found';
  end if;

  insert into public.expenses (
    expense_date, category_id, description, amount, vendor, notes, created_by
  )
  values (
    coalesce(p_expense_date, current_date),
    p_category_id,
    btrim(p_description),
    p_amount,
    nullif(btrim(p_vendor), ''),
    nullif(btrim(p_notes), ''),
    auth.uid()
  )
  returning * into result;

  return result;
end;
$$;

revoke all on function public.record_expense(text, numeric, date, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.record_expense(text, numeric, date, uuid, text, text)
  to authenticated;

create or replace function public.void_expense(
  p_expense_id uuid,
  p_reason text
)
returns public.expenses
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  result public.expenses;
begin
  if auth.uid() is null or not private.is_owner() then
    raise exception 'Only an owner can void expenses' using errcode = '42501';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A void reason of at least 3 characters is required';
  end if;

  update public.expenses
  set
    voided_at = now(),
    voided_by = auth.uid(),
    void_reason = btrim(p_reason)
  where id = p_expense_id
    and voided_at is null
  returning * into result;

  if not found then
    raise exception 'Expense not found or already voided';
  end if;

  return result;
end;
$$;

revoke all on function public.void_expense(uuid, text)
  from public, anon, authenticated;
grant execute on function public.void_expense(uuid, text)
  to authenticated;