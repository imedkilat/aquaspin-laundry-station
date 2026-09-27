-- Public order tracking RPC
-- Allows customers to look up the live status of their laundry using their
-- public transaction code (e.g. from scanning a thermal receipt QR code or clicking an SMS link).
-- Security definer so anon clients can view non-sensitive order progress without granting
-- any direct table privileges to the anon role.

create or replace function public.get_public_order_status(p_code text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if p_code is null or btrim(p_code) = '' then
    return jsonb_build_object('found', false, 'error', 'Invalid tracking code');
  end if;

  select jsonb_build_object(
    'found', true,
    'transaction_code', t.transaction_code,
    'order_status', t.order_status,
    'service_name', coalesce(t.service_label_snapshot, s.label, 'Laundry service'),
    'kg', t.kg,
    'no_of_loads', t.no_of_loads,
    'total_amount', t.total_amount,
    'payment_method', t.payment_method,
    'is_paid', (t.payment_method in ('paid', 'gcash')),
    'transaction_date', t.transaction_date,
    'pickup_date', t.pickup_date,
    'pickup_time', t.pickup_time,
    'created_at', t.created_at,
    'updated_at', t.updated_at,
    'shop_name', coalesce((select shop_display_name from public.shop_settings where id = 1), 'Aquaspin Laundry Station'),
    'shop_phone', (select contact_phone from public.shop_settings where id = 1),
    'shop_address', (select address from public.shop_settings where id = 1)
  )
  into result
  from public.transactions t
  left join public.services s on s.id = t.service_id
  where upper(btrim(t.transaction_code)) = upper(btrim(p_code))
    and t.deleted_at is null;

  if result is null then
    return jsonb_build_object('found', false, 'error', 'Order not found');
  end if;

  return result;
end;
$$;

revoke all on function public.get_public_order_status(text) from public;
grant execute on function public.get_public_order_status(text) to anon, authenticated;
