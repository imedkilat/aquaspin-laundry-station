-- Loyalty points must count the weight of EVERY service on the order, not
-- just the primary service, now that "Add New Service" lets one transaction
-- carry additional service lines (see 20260930030000_transaction_service_items.sql).
--
-- Before this migration, private.award_loyalty_points_on_completion() only
-- read transactions.kg (the primary service's own weight), which was the
-- correct and only meaning of "the order's weight" before multi-service
-- orders existed. Its own comment said so explicitly: "Loyalty points
-- already read transactions.kg directly and need no change (kg keeps its
-- primary-only meaning)". That was true only because no order could have
-- more than one service's weight at the time it was written.
--
-- The gap this closes: a customer availing 8kg Wash-Dry-Fold + 8kg Premium
-- Wash-Dry-Fold as ONE multi-service transaction only earned points for the
-- 8kg primary service, even though the shop processed 16kg of laundry for
-- them - the same customer availing the same two services as two SEPARATE
-- transactions would have earned for the full 16kg. This also means an
-- order whose primary service is flat-priced (kg is null) but which has a
-- weight-based additional service line now correctly earns points for that
-- line's weight, instead of earning nothing at all.
--
-- Nothing else changes: points are still awarded exactly once per
-- transaction (the existing `on conflict (transaction_id) do nothing` on
-- loyalty_point_events, unique on transaction_id), only on the transition
-- to 'completed', only for a non-deleted transaction with a linked
-- customer, and only when the shop's points_per_kg setting is configured.
-- transactions.kg and transaction_service_items.kg both keep their existing
-- meanings; this migration only changes how the total used for loyalty is
-- computed.

begin;

create or replace function private.award_loyalty_points_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_points_per_kg numeric;
  v_service_items_kg numeric;
  v_total_kg numeric;
begin
  if old.order_status is distinct from new.order_status
    and new.order_status = 'completed'
    and new.customer_id is not null
    and new.deleted_at is null then

    select coalesce(sum(kg), 0)
      into v_service_items_kg
      from public.transaction_service_items
      where transaction_id = new.id;

    v_total_kg := coalesce(new.kg, 0) + v_service_items_kg;

    if v_total_kg > 0 then
      select points_per_kg
        into v_points_per_kg
        from public.loyalty_settings
        where id = 1;

      if v_points_per_kg is not null then
        insert into public.loyalty_point_events (customer_id, transaction_id, kg, points_earned)
        values (new.customer_id, new.id, v_total_kg, v_total_kg * v_points_per_kg)
        on conflict (transaction_id) do nothing;
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- create or replace preserves the function's OID, so its existing
-- "revoke all ... grant none" ACL (set in 20260926010000_loyalty_points_v1.sql)
-- is kept as-is; no grant/revoke statements are needed here. This function
-- is only ever invoked as a trigger body, which does not require the firing
-- role to hold EXECUTE on it.

commit;
