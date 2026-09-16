-- REFERENCE ONLY — DO NOT APPLY DIRECTLY.
-- Reconstructed from read-only production inspection on Sep 16, 2026.
-- Captures the current live shape associated with production migration
-- 20260916032655_fix_staff_soft_delete_rls.
--
-- PR #3 deliberately removes this exact overload and replaces it with the
-- hardened soft_delete_transaction(uuid,timestamptz,text) contract.

create or replace function public.soft_delete_transaction(
  p_id uuid,
  p_reason text,
  p_expected_updated_at timestamptz
)
returns public.transactions
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_row public.transactions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not (private.is_owner() or private.has_staff_permission('delete_transactions')) then
    raise exception 'You do not have permission to delete transactions' using errcode = '42501';
  end if;

  update public.transactions t
  set deleted_at = now(),
      delete_reason = p_reason
  where t.id = p_id
    and t.deleted_at is null
    and t.updated_at = p_expected_updated_at
    and private.can_view_transaction(t.transaction_date, t.payment_method, t.deleted_at)
  returning * into v_row;

  if not found then
    return null;
  end if;

  return v_row;
end;
$$;

revoke all on function public.soft_delete_transaction(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.soft_delete_transaction(uuid, text, timestamptz)
  to authenticated;
