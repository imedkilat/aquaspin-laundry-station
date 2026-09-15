-- Public random transaction codes + cleanup of the known Andy QA transaction.
-- The numeric transaction_no remains internal for stable ordering.

create or replace function public.generate_transaction_code()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  candidate text;
begin
  loop
    candidate := 'AQ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (
      select 1
      from public.transactions
      where transaction_code = candidate
    );
  end loop;

  return candidate;
end;
$$;

grant execute on function public.generate_transaction_code() to authenticated;

alter table public.transactions
  add column if not exists transaction_code text;

update public.transactions
set transaction_code = public.generate_transaction_code()
where transaction_code is null;

alter table public.transactions
  alter column transaction_code set default public.generate_transaction_code();

alter table public.transactions
  alter column transaction_code set not null;

create unique index if not exists transactions_transaction_code_unique_idx
  on public.transactions (transaction_code);

-- Remove the exact QA transaction previously created for Andy.
delete from public.transactions
where lower(customer_name) = 'andy'
  and transaction_date = date '2026-09-16'
  and total_amount = 180.00
  and payment_method = 'gcash';
