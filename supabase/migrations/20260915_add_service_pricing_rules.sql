-- Add configurable service pricing rules for Aquaspin.
-- Every service uses an 8 kg maximum capacity per load while remaining one transaction.

alter table public.services
  add column if not exists pricing_type text not null default 'per_load_by_weight';

alter table public.services
  add column if not exists max_kg_per_load numeric(6,2) default 8.00;

-- Make the shop-wide rule the default for future services too.
alter table public.services
  alter column pricing_type set default 'per_load_by_weight';

alter table public.services
  alter column max_kg_per_load set default 8.00;

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

-- Current catalog and any existing service use the same 8 kg/load rule.
update public.services
set pricing_type = 'per_load_by_weight',
    max_kg_per_load = 8.00;
