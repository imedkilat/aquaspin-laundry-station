-- Pin the helper's search path and index the remaining foreign key flagged
-- by the Production database advisor after the PR #29 rollout.
begin;
set local lock_timeout = '5s';

create index if not exists transaction_service_items_created_by_idx
  on public.transaction_service_items (created_by);

create or replace function private.is_drop_off_service(p_service_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select upper(btrim(coalesce(p_service_code, ''))) in ('CSDB', 'LWB', 'PWDF', 'WDF');
$$;

commit;
