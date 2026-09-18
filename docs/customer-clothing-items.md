# Customer clothing item list

Customer clothing items are operational counts attached to a transaction. They are separate from inventory consumption, add-ons, pricing, discounts, loyalty points, and transaction totals.

## Workflow

- New orders remain valid without an item list.
- Staff and Owner accounts with the existing transaction-edit permission can add or edit the list while an order is Received, Washing, Drying, or Ready for Pickup.
- The detail page shows `Add Customer Items` until rows exist, then `Edit Item List`, the item breakdown, and the total item count.
- `Other` requires a non-blank custom name. Each supported item type can appear only once per transaction.
- A completed order displays its final rows read-only.

## Database enforcement

Migration `20260921050000_customer_status_items.sql` creates `public.transaction_customer_items` with a foreign key to `transactions`, a unique `(transaction_id, item_type)` constraint, positive-integer quantity validation, and the custom-name check for `other`.

`public.save_transaction_customer_items(uuid, jsonb)` validates and atomically merges the submitted rows under the existing transaction visibility and `edit_transactions` permission rules. A trigger stamps actor metadata and rejects item mutations after completion or cancellation. Realtime publication includes the item table.

The audited `public.set_transaction_status` RPC rejects every transition to `completed` unless at least one saved item row has a quantity greater than zero. It raises:

`Please record the customer's item list before completing this order.`

This check applies to normal transitions and owner overrides. Existing transactions remain readable; incomplete transactions cannot be completed until their item list is saved.

## Verification

The backend PGlite harness covers creation without items, Staff and Owner item writes, validation, duplicate prevention, completion blocking, completion success, immutable completed rows, and realtime publication. Run it from `tests/backend` with `npm test`.
