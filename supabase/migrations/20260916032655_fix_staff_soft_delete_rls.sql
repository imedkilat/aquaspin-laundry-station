-- BLOCKER FIX: staff soft-delete was impossible under any settings.
--
-- Root cause: transactions_select_scoped (private.can_view_transaction) hides
-- ANY soft-deleted row from non-owners. PostgreSQL's row-security machinery
-- requires the resulting row of an UPDATE to remain visible under the
-- table's SELECT policy for the acting role -- this is enforced in addition
-- to (and even when) the UPDATE policy's own WITH CHECK already passes.
-- Since a staff soft-delete makes deleted_at non-null, the resulting row
-- becomes invisible to that same staff member under transactions_select_scoped,
-- so PostgreSQL rejects the UPDATE itself with "new row violates row-level
-- security policy for table transactions" -- unconditionally, regardless of
-- staff_can_delete_transactions. This reproduced with the real policy AND
-- with the UPDATE policy's WITH CHECK forced to a literal `true`, confirming
-- it is the SELECT-policy visibility of the post-update row, not the UPDATE
-- policy's own check, that blocks it.
--
-- Fix: perform the soft-delete write through a SECURITY DEFINER function so
-- the actual UPDATE runs as the function owner (which bypasses RLS on this
-- table, matching how private.is_owner()/has_staff_permission() already
-- sidestep RLS elsewhere in this schema) while the function itself still
-- enforces the exact same permission check the RLS policy was expressing.
-- Staff visibility of already-deleted rows is intentionally unchanged --
-- they still cannot browse deleted rows afterward.
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
    -- Staff can only delete rows they could actually see beforehand --
    -- deletion never outruns a staff member's own view scope.
    and private.can_view_transaction(t.transaction_date, t.payment_method, t.deleted_at)
  returning * into v_row;

  if not found then
    return null;
  end if;

  return v_row;
end;
$$;

revoke all on function public.soft_delete_transaction(uuid, text, timestamptz) from public, anon;
grant execute on function public.soft_delete_transaction(uuid, text, timestamptz) to authenticated;
