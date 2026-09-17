-- Preserve service identity on each transaction before catalog edits are allowed.
-- Existing receipts/history must continue showing the service as it was at sale time.

alter table public.transactions
  add column if not exists service_code_snapshot text,
  add column if not exists service_label_snapshot text;

update public.transactions t
set
  service_code_snapshot = s.code,
  service_label_snapshot = s.label
from public.services s
where t.service_id = s.id
  and (t.service_code_snapshot is null or t.service_label_snapshot is null);

create or replace function public.populate_transaction_service_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  service_row public.services%rowtype;
begin
  if new.service_id is null then
    return new;
  end if;

  if tg_op = 'INSERT'
     or new.service_id is distinct from old.service_id
     or new.service_code_snapshot is null
     or new.service_label_snapshot is null then
    select * into service_row
    from public.services
    where id = new.service_id;

    if not found then
      raise exception 'Selected service does not exist';
    end if;

    new.service_code_snapshot := service_row.code;
    new.service_label_snapshot := service_row.label;
  end if;

  return new;
end;
$$;

revoke all on function public.populate_transaction_service_snapshot() from public, anon, authenticated;

drop trigger if exists transactions_populate_service_snapshot on public.transactions;
create trigger transactions_populate_service_snapshot
  before insert or update of service_id, service_code_snapshot, service_label_snapshot
  on public.transactions
  for each row execute function public.populate_transaction_service_snapshot();
