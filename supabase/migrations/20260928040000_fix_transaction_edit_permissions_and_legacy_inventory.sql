-- Restore authenticated edits for inventory fields added after the original
-- transaction column grant. RLS and the staff-permission trigger still decide
-- which signed-in user may update a transaction.
grant update (
  detergent_source,
  detergent_item_id,
  detergent_quantity,
  detergent_other_reason,
  fabric_conditioner_source,
  fabric_conditioner_item_id,
  fabric_conditioner_quantity,
  fabric_conditioner_other_reason
) on public.transactions to authenticated;
