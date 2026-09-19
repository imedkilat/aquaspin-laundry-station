-- Keep the staff-creation Edge Function allowed to use its service-role rate
-- limiter, and preserve the no-update-on-conflict profile behavior in SQL.
begin;
set local lock_timeout = '5s';

grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

commit;
