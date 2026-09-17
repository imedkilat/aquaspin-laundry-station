-- Optional pickup time alongside the existing pickup_date, so staff can
-- record e.g. "Sept 16, 2026, 3:00 PM" instead of just the date. Additive
-- and nullable -- existing rows and the CSV/Sheets export are unaffected
-- until this is wired up on the export side too.
alter table public.transactions
  add column if not exists pickup_time time;
