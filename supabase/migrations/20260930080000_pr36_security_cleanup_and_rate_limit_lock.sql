begin;

set local lock_timeout = '5s';

-- Remove the legacy anonymous tracking endpoint in any environment where the
-- original migration was already applied. The signed capability endpoint is
-- the only public tracking path.
drop function if exists public.get_public_order_status(text);

-- Serialize checks for the same rate key so concurrent requests cannot all
-- observe the same below-limit count and over-admit. A hash collision only
-- causes unrelated keys to wait on the same transaction lock.
create or replace function public.check_rate_limit(p_key text, p_max_count int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_key));

  delete from public.rate_limit_hits
   where rate_key = p_key
     and created_at < pg_catalog.now() - pg_catalog.make_interval(secs => p_window_seconds);

  select pg_catalog.count(*) into v_count
    from public.rate_limit_hits
   where rate_key = p_key
     and created_at >= pg_catalog.now() - pg_catalog.make_interval(secs => p_window_seconds);

  if v_count >= p_max_count then
    return false;
  end if;

  insert into public.rate_limit_hits (rate_key) values (p_key);
  return true;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

commit;
