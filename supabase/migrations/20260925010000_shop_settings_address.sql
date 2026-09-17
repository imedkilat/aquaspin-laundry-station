-- Phase 6: optional shop address for settings and printed receipts.
-- Forward-only additive change; existing shop settings and data are preserved.

alter table public.shop_settings
  add column if not exists address text
    check (address is null or char_length(address) <= 200);

