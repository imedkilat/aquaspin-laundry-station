-- Add configurable service pricing rules for Aquaspin.
-- WDF is automatically split into 8 kg loads while remaining one transaction.

alter table public.services
  add column if not exists pricing_type text not null default 'per_load_manual';

alter table public.services
  add column if not exists max_kg_per_load numeric(6,2);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'services_pricing_type_check'
      and conrelid = 'public.services'::regclass
  ) then
    alter table public.services
      add constraint services_pricing_type_check
      check (pricing_type in ('per_load_by_weight', 'per_load_manual', 'per_item'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'services_max_kg_per_load_check'
      and conrelid = 'public.services'::regclass
  ) then
    alter table public.services
      add constraint services_max_kg_per_load_check
      check (max_kg_per_load is null or max_kg_per_load > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'services_weight_pricing_requires_capacity_check'
      and conrelid = 'public.services'::regclass
  ) then
    alter table public.services
      add constraint services_weight_pricing_requires_capacity_check
      check (pricing_type <> 'per_load_by_weight' or max_kg_per_load is not null);
  end if;
end
$$;

update public.services
set pricing_type = 'per_load_by_weight',
    max_kg_per_load = 8.00
where code = 'WDF';

update public.services
set pricing_type = 'per_load_manual',
    max_kg_per_load = null
where code in ('SSW', 'SSD');

update public.services
set pricing_type = 'per_item',
    max_kg_per_load = null
where code = 'CSDB';
