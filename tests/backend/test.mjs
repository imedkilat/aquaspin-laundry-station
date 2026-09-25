import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

// In-memory PostgreSQL only. No URLs, production credentials, or network clients.
const db = new PGlite();
const root = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
let passed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); passed++; }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); throw error; }
}
async function rejects(sql, params, code) {
  await assert.rejects(q(sql, params), e => e.code === code);
}
const owner = '00000000-0000-4000-8000-000000000001';
const staff = '00000000-0000-4000-8000-000000000002';
let inventoryUsageEnabled = false;
async function asUser(id, role = 'authenticated') {
  await db.exec('reset role');
  await q("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
  await db.exec(`set role ${role}`);
}
async function admin() { await asUser(null, 'postgres'); }
async function setting(column, value) {
  await asUser(owner);
  await db.exec(`update public.shop_settings set ${column} = ${value} where id = 1`);
}
async function transaction(fields = {}) {
  const data = {
    customer_name: 'Snapshot Name',
    phone_number: '09171234567',
    created_by: owner,
    ...(inventoryUsageEnabled ? {
      detergent_source: 'customer_supplied',
      detergent_other_reason: 'Customer-provided detergent',
      fabric_conditioner_source: 'customer_supplied',
      fabric_conditioner_other_reason: 'Customer-provided fabric conditioner',
    } : {}),
    ...fields,
  };
  const keys = Object.keys(data);
  return one(`insert into public.transactions (${keys.join(',')}) values (${keys.map((_, i) => '$' + (i + 1)).join(',')}) returning *, updated_at::text as token`, Object.values(data));
}
async function fresh(id) { return one('select *, updated_at::text as token from public.transactions where id=$1', [id]); }
async function serviceId(code) {
  const service = await one('select id from public.services where code=$1', [code]);
  assert.ok(service, `Test service ${code} must exist`);
  return service.id;
}
async function status(t, next, reason = null, override = false) {
  return one('select *, updated_at::text as token from public.set_transaction_status($1,$2,$3,$4,$5)', [t.id, next, t.token, reason, override]);
}
async function customerItems(t, items) {
  return q('select * from public.save_transaction_customer_items($1,$2::jsonb)', [t.id, JSON.stringify(items)]);
}
async function pendingCustomerItems() {
  return q(`
    select t.id, t.order_status
    from public.transactions t
    where t.deleted_at is null
      and t.transaction_date <= (now() at time zone 'Asia/Manila')::date
      and private.is_drop_off_service(t.service_code_snapshot)
      and t.order_status in ('received', 'washing', 'drying', 'ready_for_pickup', 'on_hold')
      and not exists (
        select 1
        from public.transaction_customer_items i
        where i.transaction_id = t.id
          and i.quantity > 0
      )
    order by t.id
  `);
}
async function softDelete(t, reason = 'Routine deletion') {
  return one('select * from public.soft_delete_transaction($1,$2,$3)', [t.id, t.token, reason]);
}

try {
  // Minimal Supabase platform shims; application schema, functions and RLS are real SQL.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    -- Shapes mirror GoTrue: deleting a session cascades to its refresh tokens.
    create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now());
    create table auth.refresh_tokens (id bigserial primary key, user_id varchar, session_id uuid references auth.sessions(id) on delete cascade, revoked boolean not null default false);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to public;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key, bucket_id text, name text);
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
    create publication supabase_realtime;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);
  await db.exec(await read('supabase/schema.sql'));
  const filenames = (await readdir(new URL('supabase/migrations/', root))).sort();
  // Historical filenames are not chronological: AQ codes depend on the shorter GCash migration.
  const early = ['20260915_add_service_pricing_rules.sql', '20260915161000_add_gcash_reference.sql', '20260916_enable_services_realtime.sql'];
  const isCustomerStatusMigration = file => file.includes('customer_status_') || file.includes('customer_rls_initplan_hardening');
  const migrationNumber = file => {
    const raw = file.match(/^(\d+)_/)?.[1] || '0';
    return BigInt(raw.length === 8 ? `${raw}000000` : raw);
  };
  const deferredBeforeStatus = '20260916024806_customer_sms_notifications.sql';
  const baseline = [...early, ...filenames.filter(f => !early.includes(f) && f !== deferredBeforeStatus && !isCustomerStatusMigration(f) && migrationNumber(f) < 20260921010000n)];
  for (const file of baseline) await db.exec(await read('supabase/migrations/' + file));
  await db.exec(`insert into auth.users(id,email) values ('${owner}','owner@test.local'), ('${staff}','staff@test.local');`);
  // Test fixture bootstrapping before customer/status changes; honor existing profile guard.
  await db.exec('alter table public.profiles disable trigger profiles_enforce_safe_self_update');
  await q("update public.profiles set role='owner' where id=$1", [owner]);
  await db.exec('alter table public.profiles enable trigger profiles_enforce_safe_self_update');
  await asUser(owner);
  const legacy = await transaction();
  const legacyEditTarget = await transaction({ customer_name: 'Legacy edit target', phone_number: null });
  const legacyDeleted = await transaction({ customer_name: 'Deleted legacy' });
  await q("update public.transactions set deleted_at=now(), delete_reason='Duplicate entry' where id=$1", [legacyDeleted.id]);
  await admin();
  const migrations = filenames.filter(isCustomerStatusMigration);
  assert.equal(migrations.length, 5, 'All forward customer/status migrations must exist');
  await test('migration 1 denies status and SMS direct UPDATE with drifted columns', async () => {
    const before = await one("select count(*)::int as count from pg_attribute where attrelid='public.transactions'::regclass and attname in ('sms_sent_at','sms_sent_by','sms_message_id') and not attisdropped");
    assert.equal(before.count, 0, 'Baseline schema has no optional SMS audit columns');
    await db.exec('alter table public.transactions add column sms_sent_at timestamptz, add column sms_sent_by uuid, add column sms_message_id text');
    await db.exec(await read('supabase/migrations/' + migrations[0]));
    for (const column of ['sms_sent_at', 'sms_sent_by', 'sms_message_id', 'order_status']) {
      assert.equal((await one(`select has_column_privilege('authenticated','public.transactions','${column}','UPDATE') allowed`)).allowed, false);
    }
  });
  await test('migration 2 removes legacy RPC before migration 3', async () => {
    await db.exec(`
      drop function if exists public.soft_delete_transaction(uuid, text, timestamptz);
      create function public.soft_delete_transaction(uuid, text, timestamptz)
      returns boolean language sql immutable as $$ select false $$;
      revoke all on function public.soft_delete_transaction(uuid, text, timestamptz) from public, anon, authenticated;
      grant execute on function public.soft_delete_transaction(uuid, text, timestamptz) to authenticated;
    `);
    assert.equal((await one("select to_regprocedure('public.soft_delete_transaction(uuid,text,timestamptz)') is not null present")).present, true);
    await db.exec(await read('supabase/migrations/' + migrations[1]));
    assert.equal((await one("select to_regprocedure('public.soft_delete_transaction(uuid,text,timestamptz)') is null gone")).gone, true);
    assert.equal((await one("select to_regprocedure('public.soft_delete_transaction(uuid,timestamptz,text)') is not null hardened")).hardened, true);
    const rpcGrants = await one("select has_function_privilege('authenticated','public.soft_delete_transaction(uuid,timestamptz,text)','execute') as auth_ok, has_function_privilege('anon','public.soft_delete_transaction(uuid,timestamptz,text)','execute') as anon_ok");
    assert.equal(rpcGrants.auth_ok, true); assert.equal(rpcGrants.anon_ok, false);
  });
  await test('migration 3 preserves hardened RPC and least-privilege grants', async () => {
    await db.exec(await read('supabase/migrations/' + migrations[2]));
    assert.equal((await one("select to_regprocedure('public.soft_delete_transaction(uuid,text,timestamptz)') is null gone")).gone, true);
    assert.equal((await one("select to_regprocedure('public.soft_delete_transaction(uuid,timestamptz,text)') is not null hardened")).hardened, true);
    const rpcGrants = await one("select has_function_privilege('authenticated','public.soft_delete_transaction(uuid,timestamptz,text)','execute') as auth_ok, has_function_privilege('anon','public.soft_delete_transaction(uuid,timestamptz,text)','execute') as anon_ok");
    assert.equal(rpcGrants.auth_ok, true); assert.equal(rpcGrants.anon_ok, false);
    for (const column of ['sms_sent_at', 'sms_sent_by', 'sms_message_id', 'order_status']) {
      assert.equal((await one(`select has_column_privilege('authenticated','public.transactions','${column}','UPDATE') allowed`)).allowed, false);
    }
    await asUser(staff);
    assert.equal((await q('select id from transactions where id=$1', [legacyDeleted.id])).length, 0);
    assert.equal((await q('select id from transaction_status_history where transaction_id=$1', [legacyDeleted.id])).length, 0);
    await asUser(owner);
    assert.equal((await q('select id from transactions where id=$1', [legacyDeleted.id])).length, 1);
    assert.ok((await q('select id from transaction_status_history where transaction_id=$1', [legacyDeleted.id])).length > 0);
  });
  await admin();
  await db.exec(await read('supabase/migrations/' + migrations[3]));
  await db.exec(await read('supabase/migrations/' + migrations[4]));
  await db.exec(await read('supabase/migrations/' + deferredBeforeStatus));
  for (const file of filenames.filter(f => !early.includes(f) && !isCustomerStatusMigration(f) && migrationNumber(f) > 20260921050000n)) {
    await db.exec(await read('supabase/migrations/' + file));
  }
  inventoryUsageEnabled = true;
  await asUser(owner);
  await test('normal authenticated edit payload supports legacy and inventory-backed transactions', async () => {
    const legacyEdit = await one(`update public.transactions set
      customer_name='Legacy edit saved',
      phone_number=null,
      transaction_date=transaction_date,
      service_id=null,
      kg=null,
      no_of_loads=null,
      base_amount=0,
      add_ons=0,
      total_amount=0,
      cash_amount=0,
      gcash_amount=0,
      gcash_reference=null,
      payment_method='pay_later',
      pickup_date=null,
      notes='Legacy edit regression'
      where id=$1
      returning *`, [legacyEditTarget.id]);
    assert.equal(legacyEdit.customer_name, 'Legacy edit saved');
    assert.equal(legacyEdit.detergent_source, null);
    assert.equal(legacyEdit.fabric_conditioner_source, null);

    for (const column of [
      'detergent_source', 'detergent_item_id', 'detergent_quantity', 'detergent_other_reason',
      'fabric_conditioner_source', 'fabric_conditioner_item_id', 'fabric_conditioner_quantity', 'fabric_conditioner_other_reason',
    ]) {
      assert.equal((await one(`select has_column_privilege('authenticated','public.transactions',$1,'UPDATE') allowed`, [column])).allowed, true);
    }

    const inventoryEdit = await transaction({ customer_name: 'Inventory edit regression', phone_number: null });
    const inventoryUpdated = await one(`update public.transactions set
      detergent_source='customer_supplied',
      detergent_item_id=null,
      detergent_quantity=null,
      detergent_other_reason='Customer provided detergent',
      fabric_conditioner_source='customer_supplied',
      fabric_conditioner_item_id=null,
      fabric_conditioner_quantity=null,
      fabric_conditioner_other_reason='Customer provided conditioner'
      where id=$1
      returning *`, [inventoryEdit.id]);
    assert.equal(inventoryUpdated.detergent_source, 'customer_supplied');
    assert.equal(inventoryUpdated.fabric_conditioner_source, 'customer_supplied');

    let completedInventory = await transaction({ customer_name: 'Completed inventory guard', phone_number: null });
    completedInventory = await status(completedInventory, 'washing');
    completedInventory = await status(completedInventory, 'drying');
    completedInventory = await status(completedInventory, 'ready_for_pickup');
    completedInventory = await status(completedInventory, 'completed');

    await asUser(owner);
    await assert.rejects(
      q("update public.transactions set detergent_source='inventory', detergent_quantity=500 where id=$1", [completedInventory.id]),
      e => e.code === '42501' && e.message.includes('completed or cancelled'),
    );

    await setting('staff_can_edit_transactions', true);
    await asUser(staff);
    await assert.rejects(
      q("update public.transactions set fabric_conditioner_other_reason='Changed after completion' where id=$1", [completedInventory.id]),
      e => e.code === '42501' && e.message.includes('completed or cancelled'),
    );
    assert.equal((await fresh(completedInventory.id)).detergent_quantity, null);
    assert.equal((await fresh(completedInventory.id)).fabric_conditioner_other_reason, 'Customer-provided fabric conditioner');
    await asUser(owner);
  });
  await test('consumed inventory usage stays immutable after owner reopens an order', async () => {
    await admin();
    const detergentCategory = await one(`insert into public.inventory_categories
      (name, created_by, updated_by) values ('Liquid Detergent', $1, $1) returning id`, [owner]);
    const conditionerCategory = await one(`insert into public.inventory_categories
      (name, created_by, updated_by) values ('Fabric Conditioner', $1, $1) returning id`, [owner]);
    const detergentItem = await one(`insert into public.inventory_items
      (item_name, category_id, unit_label, average_cost, created_by, updated_by)
      values ('Reopen Guard Detergent', $1, 'ml', 2, $2, $2) returning id`, [detergentCategory.id, owner]);
    const conditionerItem = await one(`insert into public.inventory_items
      (item_name, category_id, unit_label, average_cost, created_by, updated_by)
      values ('Reopen Guard Conditioner', $1, 'ml', 2, $2, $2) returning id`, [conditionerCategory.id, owner]);
    await q(`insert into public.inventory_stock_movements
      (item_id, movement_type, quantity_delta, unit_cost, reason, created_by)
      values ($1, 'stock_in', 1000, 2, 'Reopen guard fixture', $3),
             ($2, 'stock_in', 1000, 2, 'Reopen guard fixture', $3)`, [detergentItem.id, conditionerItem.id, owner]);

    await asUser(owner);
    let consumed = await transaction({
      customer_name: 'Consumed inventory reopen guard',
      phone_number: null,
      detergent_source: 'inventory',
      detergent_item_id: detergentItem.id,
      detergent_quantity: 50,
      detergent_other_reason: null,
      fabric_conditioner_source: 'inventory',
      fabric_conditioner_item_id: conditionerItem.id,
      fabric_conditioner_quantity: 25,
      fabric_conditioner_other_reason: null,
    });
    consumed = await status(consumed, 'washing');
    consumed = await status(consumed, 'drying');
    consumed = await status(consumed, 'ready_for_pickup');
    consumed = await status(consumed, 'completed');

    const before = await one(`select t.detergent_item_id, t.detergent_quantity,
      t.fabric_conditioner_item_id, t.fabric_conditioner_quantity,
      (select count(*)::int from public.inventory_stock_movements m where m.item_id in ($1, $2)) movement_count,
      (select count(*)::int from public.transaction_inventory_consumption c where c.transaction_id = $3) consumption_count
      from public.transactions t where t.id = $3`, [detergentItem.id, conditionerItem.id, consumed.id]);
    consumed = await status(consumed, 'ready_for_pickup', 'Reopen approved for correction', true);

    await assert.rejects(
      q(`update public.transactions set
        detergent_item_id=$1, detergent_quantity=500
        where id=$2`, [conditionerItem.id, consumed.id]),
      e => e.code === '42501' && e.message.includes('stock consumption'),
    );
    const after = await one(`select t.detergent_item_id, t.detergent_quantity,
      t.fabric_conditioner_item_id, t.fabric_conditioner_quantity,
      (select count(*)::int from public.inventory_stock_movements m where m.item_id in ($1, $2)) movement_count,
      (select count(*)::int from public.transaction_inventory_consumption c where c.transaction_id = $3) consumption_count
      from public.transactions t where t.id = $3`, [detergentItem.id, conditionerItem.id, consumed.id]);
    assert.equal(after.detergent_item_id, before.detergent_item_id);
    assert.equal(Number(after.detergent_quantity), Number(before.detergent_quantity));
    assert.equal(after.fabric_conditioner_item_id, before.fabric_conditioner_item_id);
    assert.equal(Number(after.fabric_conditioner_quantity), Number(before.fabric_conditioner_quantity));
    assert.equal(after.movement_count, before.movement_count);
    assert.equal(after.consumption_count, before.consumption_count);

    consumed = await status(await fresh(consumed.id), 'cancelled', 'Customer cancelled after reopen', true);
    await assert.rejects(
      q("update public.transactions set fabric_conditioner_quantity=75 where id=$1", [consumed.id]),
      e => e.code === '42501' && e.message.includes('completed or cancelled'),
    );
  });
  await test('customer item workflow enforces validation, permissions, completion, and history', async () => {
    const wdfServiceId = await serviceId('WDF');
    const grants = await one("select has_function_privilege('authenticated','public.save_transaction_customer_items(uuid,jsonb)','execute') auth_ok, has_function_privilege('anon','public.save_transaction_customer_items(uuid,jsonb)','execute') anon_ok");
    assert.equal(grants.auth_ok, true); assert.equal(grants.anon_ok, false);
    assert.equal((await q("select * from pg_publication_tables where pubname='supabase_realtime' and tablename='transaction_customer_items'")).length, 1);
    const empty = await transaction({ customer_name: 'No item list yet', phone_number: null, service_id: wdfServiceId });
    assert.equal((await q('select id from transaction_customer_items where transaction_id=$1', [empty.id])).length, 0);
    const existingWithoutItems = await transaction({ customer_name: 'Existing Drop Off without items', phone_number: null, service_id: wdfServiceId });
    assert.equal((await q('select id from transaction_customer_items where transaction_id=$1', [existingWithoutItems.id])).length, 0);
    await assert.rejects(status(existingWithoutItems, 'completed'), e => e.code === '23514' && e.message.includes("Please record the customer's item list before completing this order."));
    assert.equal((await fresh(existingWithoutItems.id)).order_status, 'received');
    await asUser(staff);
    const staffOrder = await transaction({ created_by: staff, customer_name: 'Staff clothing items', phone_number: null, service_id: wdfServiceId });
    assert.equal((await customerItems(staffOrder, [{ item_type: 'shorts', quantity: 2 }, { item_type: 'other', quantity: 1, custom_item_name: 'Blanket' }])).length, 2);
    await asUser(owner);
    assert.equal((await customerItems(staffOrder, [{ item_type: 'shorts', quantity: 4 }, { item_type: 'towels', quantity: 3 }])).length, 2);
    assert.equal((await one("select quantity from transaction_customer_items where transaction_id=$1 and item_type='shorts'", [staffOrder.id])).quantity, 4);
    assert.equal((await q('select item_type from transaction_customer_items where transaction_id=$1', [staffOrder.id])).length, 2);
    const customItems = await customerItems(staffOrder, [
      { item_type: 'shorts', quantity: 4 },
      { item_type: 'custom', quantity: 2, custom_item_name: 'Curtain' },
      { item_type: 'custom', quantity: 1, custom_item_name: 'Baby Blanket' },
    ]);
    assert.equal(customItems.length, 3);
    assert.equal((await q("select quantity from transaction_customer_items where transaction_id=$1 and item_type='custom' and custom_item_name='Curtain'", [staffOrder.id]))[0].quantity, 2);
    await assert.rejects(customerItems(staffOrder, [
      { item_type: 'custom', quantity: 1, custom_item_name: 'Curtain' },
      { item_type: 'custom', quantity: 1, custom_item_name: 'curtain' },
    ]), e => e.code === '22023');
    await assert.rejects(customerItems(staffOrder, [{ item_type: 'shorts', quantity: 0 }]), e => e.code === '22023');
    await assert.rejects(customerItems(staffOrder, [{ item_type: 'other', quantity: 1 }]), e => e.code === '22023');
    await assert.rejects(customerItems(staffOrder, [{ item_type: 'shorts', quantity: 1 }, { item_type: 'shorts', quantity: 2 }]), e => e.code === '22023');
    let blocked = await transaction({ customer_name: 'Blocked completion', phone_number: null, service_id: wdfServiceId });
    blocked = await status(blocked, 'washing'); blocked = await status(blocked, 'drying'); blocked = await status(blocked, 'ready_for_pickup');
    await assert.rejects(status(blocked, 'completed'), e => e.code === '23514' && e.message.includes("Please record the customer's item list before completing this order."));
    await customerItems(blocked, [{ item_type: 'pants', quantity: 1 }]);
    blocked = await status(await fresh(blocked.id), 'completed');
    assert.equal(blocked.order_status, 'completed');
    assert.equal((await q('select id from transaction_customer_items where transaction_id=$1', [blocked.id])).length, 1);
    await assert.rejects(customerItems(blocked, [{ item_type: 'pants', quantity: 2 }]), e => e.code === '42501');
    await asUser(owner);
  });
  await test('customer items pending coverage follows status, quantity, date, deletion, and RLS rules', async () => {
    const wdfServiceId = await serviceId('WDF');
    const received = await transaction({ customer_name: 'Pending received', phone_number: null, service_id: wdfServiceId });
    let washing = await transaction({ customer_name: 'Pending washing', phone_number: null, service_id: wdfServiceId });
    washing = await status(washing, 'washing');
    let ready = await transaction({ customer_name: 'Pending ready', phone_number: null, service_id: wdfServiceId });
    ready = await status(ready, 'ready_for_pickup', 'Wash and dry completed');
    const covered = await transaction({ customer_name: 'Covered item list', phone_number: null, service_id: wdfServiceId });
    await customerItems(covered, [{ item_type: 'towels', quantity: 2 }]);
    let completed = await transaction({ customer_name: 'Completed item list', phone_number: null, service_id: wdfServiceId });
    await customerItems(completed, [{ item_type: 'pants', quantity: 1 }]);
    completed = await status(completed, 'washing');
    completed = await status(completed, 'drying');
    completed = await status(completed, 'ready_for_pickup');
    completed = await status(completed, 'completed');
    const cancelled = await transaction({ customer_name: 'Cancelled no item list', phone_number: null, service_id: wdfServiceId });
    await status(cancelled, 'cancelled', 'Customer cancelled');
    const deleted = await transaction({ customer_name: 'Deleted no item list', phone_number: null, service_id: wdfServiceId });
    await softDelete(deleted, 'Duplicate pending fixture');
    const future = await transaction({ customer_name: 'Future no item list', phone_number: null, service_id: wdfServiceId, transaction_date: '2099-01-01' });

    const pending = await pendingCustomerItems();
    const pendingIds = pending.map(row => row.id);
    assert.ok(pendingIds.includes(received.id));
    assert.ok(pendingIds.includes(washing.id));
    assert.ok(pendingIds.includes(ready.id));
    assert.equal(pendingIds.includes(covered.id), false);
    assert.equal(pendingIds.includes(completed.id), false);
    assert.equal(pendingIds.includes(cancelled.id), false);
    assert.equal(pendingIds.includes(deleted.id), false);
    assert.equal(pendingIds.includes(future.id), false);
    assert.equal(new Set(pendingIds).size, pendingIds.length, 'pending coverage must not duplicate transactions');

    await customerItems(received, [{ item_type: 'shorts', quantity: 1 }]);
    assert.equal((await pendingCustomerItems()).some(row => row.id === received.id), false, 'saving a positive item removes the order from pending');
    await q('delete from public.transaction_customer_items where transaction_id=$1', [received.id]);
    assert.equal((await pendingCustomerItems()).some(row => row.id === received.id), true, 'removing all items makes the active order pending again');

    await asUser(staff);
    const staffPending = await pendingCustomerItems();
    assert.ok(staffPending.some(row => row.id === received.id), 'Staff sees the same visible pending order through existing RLS');
    await asUser(owner);
  });
  await test('customer item requirements apply only to Drop Off services', async () => {
    await admin();
    await q(`
      insert into public.services (code, label, default_rate, pricing_type, max_kg_per_load)
      values
        ('LWB', 'Laundry Wash Basic', 100, 'per_load_by_weight', 8),
        ('PWDF', 'Premium Wash-Dry-Fold', 250, 'per_load_by_weight', 8),
        ('WDSS', 'Self-Service Wash-Dry', 120, 'per_load_by_weight', 8)
      on conflict (code) do nothing
    `);
    const classification = await q(`
      select code, private.is_drop_off_service(code) as is_drop_off
      from (values ('CSDB'), ('LWB'), ('PWDF'), ('WDF'), ('SSD'), ('SSW'), ('WDSS'), ('UNKNOWN')) as codes(code)
      order by code
    `);
    assert.deepEqual(Object.fromEntries(classification.map(row => [row.code, row.is_drop_off])), {
      CSDB: true, LWB: true, PWDF: true, SSD: false, SSW: false, UNKNOWN: false, WDSS: false, WDF: true,
    });
    await asUser(owner);

    const wdfServiceId = await serviceId('WDF');
    let dropOff = await transaction({ customer_name: 'Drop Off without items', phone_number: null, service_id: wdfServiceId });
    assert.equal((await pendingCustomerItems()).some(row => row.id === dropOff.id), true);
    await assert.rejects(status(dropOff, 'completed', 'Drop Off completion attempt'), e => e.code === '23514' && e.message.includes("Please record the customer's item list before completing this order."));
    assert.equal((await fresh(dropOff.id)).order_status, 'received');

    let dropOffWithItems = await transaction({ customer_name: 'Drop Off with items', phone_number: null, service_id: wdfServiceId });
    await customerItems(dropOffWithItems, [{ item_type: 'towels', quantity: 2 }]);
    dropOffWithItems = await status(dropOffWithItems, 'washing');
    dropOffWithItems = await status(dropOffWithItems, 'drying');
    dropOffWithItems = await status(dropOffWithItems, 'ready_for_pickup');
    dropOffWithItems = await status(dropOffWithItems, 'completed');
    assert.equal(dropOffWithItems.order_status, 'completed');

    for (const code of ['WDSS', 'SSD', 'SSW']) {
      const selfService = await transaction({ customer_name: `${code} without items`, phone_number: null, service_id: await serviceId(code) });
      assert.equal((await pendingCustomerItems()).some(row => row.id === selfService.id), false, `${code} must not be pending`);
      await assert.rejects(customerItems(selfService, [{ item_type: 'shorts', quantity: 1 }]), e => e.code === '42501' && e.message.includes('only applicable to Drop Off'));
      const completedSelfService = await status(selfService, 'completed', `${code} completed without item list`);
      assert.equal(completedSelfService.order_status, 'completed');
    }

    const invalidService = await transaction({ customer_name: 'Unclassified service', phone_number: null });
    assert.equal((await pendingCustomerItems()).some(row => row.id === invalidService.id), false);
    const completedInvalidService = await status(invalidService, 'completed', 'Unclassified service completed');
    assert.equal(completedInvalidService.order_status, 'completed');
    await asUser(owner);
  });
  await asUser(owner);
  await test('legacy NULL customer, received status and honest baseline history', async () => {
    const t = await fresh(legacy.id);
    assert.equal(t.customer_id, null); assert.equal(t.order_status, 'received');
    assert.equal(t.token, legacy.token);
    const h = await one('select * from transaction_status_history where transaction_id=$1', [t.id]);
    assert.equal(h.previous_status, null); assert.equal(h.changed_by, null);
    assert.match(h.reason, /Legacy baseline/);
    assert.equal((await fresh(legacyDeleted.id)).order_status, 'received');
  });
  let customer;
  await test('create canonical customer; immutable public code and authoritative attribution', async () => {
    customer = await one("insert into customers(full_name,phone_number) values ('Customer A','09171234567') returning *");
    assert.match(customer.customer_code, /^CUS-[0-9A-F]{16}$/);
    assert.equal(customer.created_by, owner);
    await rejects("update customers set customer_code='CUS-0000000000000000' where id=$1", [customer.id], '42501');
  });
  await test('PH normalized phone lookup; unsupported input stays unmatched', async () => {
    for (const phone of ['09171234567', '+639171234567', '639171234567', '+63 (917) 123-4567']) {
      assert.equal((await q('select id from customers where normalized_phone=normalize_customer_phone($1)', [phone])).length, 1);
    }
    assert.equal((await one("select normalize_customer_phone('text09171234567') value")).value, null);
  });
  await test('shared phone does not merge distinct customers', async () => {
    await q("insert into customers(full_name,phone_number) values ('Family Member','+639171234567')");
    assert.equal((await q("select id from customers where normalized_phone='+639171234567'")).length, 2);
  });
  const cash = await transaction({ customer_id: customer.id, base_amount: 100, total_amount: 100, cash_amount: 120, payment_method: 'paid' });
  const debt = await transaction({ customer_id: customer.id, base_amount: 200, total_amount: 200, cash_amount: 30, gcash_amount: 20 });
  await test('customer edits preserve transaction customer and phone snapshots', async () => {
    await q("update customers set full_name='Renamed', phone_number='09991234567' where id=$1", [customer.id]);
    const t = await fresh(cash.id); assert.equal(t.customer_name, 'Snapshot Name'); assert.equal(t.phone_number, '09171234567');
  });
  await test('customer summary totals, visits, last visit and Pay Later balance', async () => {
    const s = await one('select * from customer_summary where customer_id=$1', [customer.id]);
    assert.equal(s.total_transactions, 2); assert.equal(Number(s.total_billed), 300);
    assert.equal(Number(s.total_collected), 150); assert.equal(Number(s.outstanding_balance), 150); assert.ok(s.last_visit);
    assert.equal((await q('select id from customer_transaction_history where customer_id=$1', [customer.id])).length, 2);
  });
  await test('deactivate preserves history, rejects new links and hard deletion', async () => {
    await q('update customers set active=false where id=$1', [customer.id]);
    assert.equal((await q('select id from customer_transaction_history where customer_id=$1', [customer.id])).length, 2);
    await assert.rejects(transaction({ customer_id: customer.id }), e => e.code === '23514');
    await assert.rejects(q('delete from customers where id=$1', [customer.id]), e => ['42501', '23001'].includes(e.code));
  });
  await test('staff customer write permission enforced; lookup retained; owner unrestricted', async () => {
    await setting('staff_can_manage_customers', false); await asUser(staff);
    await rejects("insert into customers(full_name) values ('Denied')", [], '42501');
    assert.equal((await q("update customers set full_name='Denied' where id=$1 returning id", [customer.id])).length, 0);
    assert.ok((await q('select id from customers')).length > 0);
    await asUser(owner); await q('update customers set active=true where id=$1', [customer.id]);
    await setting('staff_can_manage_customers', true); await asUser(staff);
    assert.ok((await one("insert into customers(full_name) values ('Staff created') returning id")).id);
    await asUser(owner);
  });
  await test('staff cannot deactivate/reactivate; owner lifecycle retains history', async () => {
    await asUser(staff);
    await rejects('update customers set active=false where id=$1', [customer.id], '42501');
    await asUser(owner);
    await q('update customers set active=false where id=$1', [customer.id]);
    assert.equal((await one('select active from customers where id=$1', [customer.id])).active, false);
    await asUser(staff);
    await rejects("insert into customers(full_name,active) values ('Inactive attempt',false)", [], '42501');
    await asUser(owner);
    await q('update customers set active=true where id=$1', [customer.id]);
    assert.equal((await one('select active from customers where id=$1', [customer.id])).active, true);
  });
  await test('unauthenticated and missing-profile users cannot use new endpoints', async () => {
    await asUser(null, 'anon'); await rejects('select * from customers', [], '42501');
    await rejects('select * from set_transaction_status($1,$2,$3)', [cash.id,'washing',cash.token], '42501');
    await asUser(null); await rejects('select * from set_transaction_status($1,$2,$3)', [cash.id,'washing',cash.token], '42501');
    assert.equal((await q('select * from customers')).length, 0);
    await asUser('00000000-0000-4000-8000-000000000099');
    await rejects("insert into customers(full_name) values ('Unprofiled')", [], '42501');
    await asUser(owner);
  });
  const lifecycleDropOffServiceId = await serviceId('WDF');
  let flow = await transaction({ service_id: lifecycleDropOffServiceId });
  await customerItems(flow, [{ item_type: 't_shirts', quantity: 1 }]);
  for (const next of ['washing', 'drying', 'ready_for_pickup', 'completed']) {
    await test(`${flow.order_status} -> ${next}; history and audit metadata`, async () => {
      const old = flow; flow = await status(flow, next);
      assert.equal(flow.order_status, next); assert.notEqual(flow.token, old.token); assert.equal(flow.updated_by, owner);
      const h = await one('select * from transaction_status_history where transaction_id=$1 order by changed_at desc limit 1', [flow.id]);
      assert.equal(h.previous_status, old.order_status); assert.equal(h.new_status, next); assert.equal(h.changed_by, owner);
    });
  }
  await test('terminal status requires reasoned owner override/reopen', async () => {
    await assert.rejects(status(flow, 'received'), e => ['22023', '42501'].includes(e.code));
    await assert.rejects(status(flow, 'received', null, true), e => e.code === '42501');
    flow = await status(flow, 'received', 'Rewash approved', true);
  });
  await test('hold/resume/cancel require reasons and preserve payment values', async () => {
    await assert.rejects(status(flow, 'on_hold'), e => e.code === '22023');
    flow = await status(flow, 'on_hold', 'Machine unavailable');
    await assert.rejects(status(flow, 'drying'), e => e.code === '22023');
    flow = await status(flow, 'drying', 'Resume after manual wash');
    flow = await status(flow, 'cancelled', 'Customer requested cancellation');
    assert.equal(flow.payment_method, 'pay_later'); assert.equal(Number(flow.total_amount), 0);
  });
  await test('hold history does not contaminate resumed forward transitions', async () => {
    await setting('staff_can_edit_transactions', true); await asUser(staff);
    let resumed = await transaction({ created_by: staff, customer_name: 'Hold resume lifecycle', service_id: lifecycleDropOffServiceId });
    resumed = await status(resumed, 'washing');
    resumed = await status(resumed, 'on_hold', 'Machine maintenance');
    resumed = await status(resumed, 'washing', 'Maintenance complete');
    resumed = await status(resumed, 'drying');
    resumed = await status(resumed, 'ready_for_pickup');
    await customerItems(resumed, [{ item_type: 'towels', quantity: 2 }]);
    resumed = await status(resumed, 'completed');
    assert.equal(resumed.order_status, 'completed');
    let skipped = await transaction({ created_by: staff, customer_name: 'Hold resume skip' });
    skipped = await status(skipped, 'washing');
    skipped = await status(skipped, 'on_hold', 'Machine maintenance');
    skipped = await status(skipped, 'washing', 'Maintenance complete');
    await assert.rejects(status(skipped, 'ready_for_pickup'), e => e.code === '22023');
    skipped = await status(skipped, 'ready_for_pickup', 'Off-machine wash and dry complete');
    assert.equal(skipped.order_status, 'ready_for_pickup');
    await asUser(owner);
  });
  await test('invalid status, skips, same status and missing concurrency token rejected', async () => {
    const t = await fresh(cash.id);
    await assert.rejects(status(t, 'invalid'), e => e.code === '22023');
    await assert.rejects(status(t, null), e => e.code === '22023');
    await assert.rejects(status(t, 'completed'), e => e.code === '22023' || e.code === '23514');
    await assert.rejects(status(t, 'received'), e => e.code === '22023');
    await assert.rejects(status({ ...t, token: null }, 'washing'), e => e.code === '22023');
  });
  await test('raw status UPDATE and noninitial INSERT rejected', async () => {
    await rejects("update transactions set order_status='washing' where id=$1", [cash.id], '42501');
    await assert.rejects(transaction({ order_status: 'completed' }), e => e.code === '23514');
    await rejects("update transactions set order_status='washing', deleted_at=now(), delete_reason='Bypass' where id=$1", [cash.id], '42501');
  });
  await test('stale status rejected without ledger append; old browser edit matches zero', async () => {
    const t = await fresh(cash.id); await status(t, 'washing');
    const count = (await q('select id from transaction_status_history where transaction_id=$1', [t.id])).length;
    await assert.rejects(status(t, 'washing'), e => e.code === '40001');
    assert.equal((await q('select id from transaction_status_history where transaction_id=$1', [t.id])).length, count);
    assert.equal((await q("update transactions set notes='stale edit' where id=$1 and updated_at=$2 returning id", [t.id,t.token])).length, 0);
    const current = await fresh(t.id);
    await q("update transactions set notes='fresh edit' where id=$1 and updated_at=$2", [t.id,current.token]);
    await assert.rejects(status(current, 'drying'), e => e.code === '40001');
  });
  await test('staff denied status when edit disabled; delete permission is insufficient', async () => {
    const t = await fresh(debt.id); await setting('staff_can_edit_transactions', false); await asUser(staff);
    await assert.rejects(status(t, 'washing'), e => e.code === '42501');
    await setting('staff_can_edit_transactions', true); await asUser(staff);
    await assert.rejects(status(t, 'completed', 'Bypass', true), e => e.code === '42501' || e.code === '23514');
    assert.equal((await status(t, 'washing')).updated_by, staff); await asUser(owner);
  });
  await test('soft delete blocks status; owner sees ledger; restore preserves lifecycle', async () => {
    const deletion = await softDelete(await fresh(debt.id), 'Duplicate entry');
    assert.equal(deletion.success, true); assert.equal(deletion.transaction_id, debt.id);
    assert.equal(Object.hasOwn(deletion, 'deleted_at'), false);
    const t = await fresh(debt.id); await assert.rejects(status(t, 'drying'), e => e.code === '42501');
    assert.ok((await q('select id from transaction_status_history where transaction_id=$1', [t.id])).length >= 2);
    const s = await one('select * from customer_summary where customer_id=$1', [customer.id]);
    assert.equal(s.total_transactions, 1); assert.equal(Number(s.outstanding_balance), 0);
    await asUser(staff); assert.equal((await q('select id from transaction_status_history where transaction_id=$1', [t.id])).length, 0);
    await asUser(owner); await q('update transactions set deleted_at=null where id=$1', [t.id]);
    assert.equal((await fresh(t.id)).order_status, 'washing');
  });
  await test('soft-delete RPC staff/owner permissions, stale token and repeated delete', async () => {
    await asUser(staff);
    const staffDelete = await transaction({ created_by: staff, customer_name: 'Staff delete RPC' });
    const deleted = await softDelete(await fresh(staffDelete.id), 'Staff requested deletion');
    assert.equal(deleted.success, true);
    assert.equal((await q('select id from transactions where id=$1', [staffDelete.id])).length, 0);
    await asUser(owner);
    await assert.rejects(softDelete(await fresh(staffDelete.id), 'Again'), e => e.code === '22023');
    await assert.rejects(softDelete({ id: cash.id, token: '2000-01-01T00:00:00.000000Z' }, 'Stale'), e => e.code === '40001');
    const ownerDelete = await transaction({ customer_name: 'Owner delete RPC' });
    assert.equal((await softDelete(await fresh(ownerDelete.id), 'Owner cleanup')).success, true);
    await asUser(staff);
    await setting('staff_can_delete_transactions', false);
    await asUser(staff);
    const denied = await transaction({ created_by: staff, customer_name: 'Denied delete RPC' });
    await assert.rejects(softDelete(await fresh(denied.id), 'Denied'), e => e.code === '42501');
    await setting('staff_can_delete_transactions', true);
    await asUser(staff);
    assert.equal((await q('update transactions set deleted_at=null where id=$1 returning id', [ownerDelete.id])).length, 0);
    await asUser(owner);
    await q('update transactions set deleted_at=null where id=$1', [ownerDelete.id]);
  });
  await test('permitted staff forward skips require reasons; backward staff movement is denied', async () => {
    await asUser(staff);
    let skip = await transaction({ created_by: staff, customer_name: 'Skip received to ready' });
    skip = await status(skip, 'ready_for_pickup', 'Self-service wash and dry completed');
    assert.equal(skip.order_status, 'ready_for_pickup');
    await assert.rejects(status(skip, 'washing'), e => e.code === '42501');
    let skip2 = await transaction({ created_by: staff, customer_name: 'Skip washing to ready' });
    skip2 = await status(skip2, 'washing');
    skip2 = await status(skip2, 'ready_for_pickup', 'Air dry completed off-machine');
    assert.equal(skip2.order_status, 'ready_for_pickup');
    let skip3 = await transaction({ created_by: staff, customer_name: 'Skip drying to complete', service_id: lifecycleDropOffServiceId });
    skip3 = await status(skip3, 'washing');
    skip3 = await status(skip3, 'drying');
    await customerItems(skip3, [{ item_type: 'jackets', quantity: 1 }]);
    skip3 = await status(skip3, 'completed', 'Customer collected directly');
    assert.equal(skip3.order_status, 'completed');
    await assert.rejects(status(skip3, 'washing', 'Reopen'), e => e.code === '42501');
    await asUser(owner);
  });
  await test('ledger is append-only, cannot forge or truncate; hard delete cannot erase history', async () => {
    await rejects('update transaction_status_history set reason=$1', ['forged'], '42501');
    await rejects('delete from transaction_status_history', [], '42501');
    await rejects('truncate transaction_status_history', [], '42501');
    await rejects("insert into transaction_status_history(transaction_id,new_status) values ($1,'washing')", [cash.id], '42501');
    await assert.rejects(q('delete from transactions where id=$1', [cash.id]), e => ['23503','23001'].includes(e.code));
    await admin(); await rejects('update transaction_status_history set reason=$1', ['forged'], '42501'); await asUser(owner);
  });
  await test('summary/history/status RPC obey historical transaction visibility', async () => {
    const historical = await transaction({ transaction_date: '2020-01-01', customer_id: customer.id, base_amount: 500, total_amount: 500 });
    await setting('staff_can_view_full_history', false); await asUser(staff);
    assert.equal((await q('select id from customer_transaction_history where id=$1', [historical.id])).length, 0);
    assert.equal(Number((await one('select * from customer_summary where customer_id=$1', [customer.id])).total_billed), 300);
    await assert.rejects(status(historical, 'washing'), e => e.code === '42501');
    await setting('staff_can_view_full_history', true); await setting('staff_can_view_historical_pay_later', false); await asUser(staff);
    assert.equal((await q('select id from customer_transaction_history where id=$1', [historical.id])).length, 0);
    await setting('staff_can_view_historical_pay_later', true); await asUser(owner);
  });
  await test('sales metrics source preserves Owner/Staff historical Pay Later visibility', async () => {
    const historicalPayLater = await transaction({ transaction_date: '2020-02-02', payment_method: 'pay_later', cash_amount: 0, gcash_amount: 0, base_amount: 125, total_amount: 125 });
    await asUser(owner);
    assert.equal((await q('select id from transactions where id=$1 and payment_method=$2', [historicalPayLater.id, 'pay_later'])).length, 1);
    await setting('staff_can_view_full_history', false); await asUser(staff);
    assert.equal((await q('select id from transactions where id=$1 and payment_method=$2', [historicalPayLater.id, 'pay_later'])).length, 0);
    await setting('staff_can_view_full_history', true); await setting('staff_can_view_historical_pay_later', false); await asUser(staff);
    assert.equal((await q('select id from transactions where id=$1 and payment_method=$2', [historicalPayLater.id, 'pay_later'])).length, 0);
    await setting('staff_can_view_historical_pay_later', true); await asUser(staff);
    assert.equal((await q('select id from transactions where id=$1 and payment_method=$2', [historicalPayLater.id, 'pay_later'])).length, 1);
    await asUser(owner);
  });
  await test('Cash, GCash reference, missing reference rejection and Pay Later regression', async () => {
    await asUser(owner);
    assert.equal(cash.payment_method, 'paid');
    await transaction({ payment_method: 'gcash', base_amount: 100, total_amount: 100, gcash_amount: 100, gcash_reference: 'QA-GCASH-1' });
    await assert.rejects(transaction({ payment_method: 'gcash', total_amount: 100, gcash_amount: 100 }), e => e.code === '23514');
    await assert.rejects(transaction({ payment_method: 'paid', total_amount: 100, cash_amount: 99 }), e => e.code === '23514');
    const editableDebt = await transaction({ customer_id: customer.id, payment_method: 'pay_later', base_amount: 75, total_amount: 75, cash_amount: 0, gcash_amount: 0 });
    let updated = await one("update transactions set payment_method='paid', cash_amount=75, gcash_amount=0, gcash_reference=null where id=$1 returning *", [editableDebt.id]);
    assert.equal(updated.payment_method, 'paid'); assert.equal(Number(updated.cash_amount), 75);
    updated = await one("update transactions set payment_method='pay_later', cash_amount=0, gcash_amount=0, gcash_reference=null where id=$1 returning *", [editableDebt.id]);
    assert.equal(updated.payment_method, 'pay_later'); assert.equal(Number(updated.cash_amount), 0);
    assert.equal(debt.payment_method, 'pay_later');
  });
  await test('status does not require new intake fields or rewrite commercial snapshots', async () => {
    const t = await transaction({ phone_number: null, base_amount: 195, total_amount: 195 });
    await setting('require_phone_number', true); await setting('require_pickup_date', true); await setting('require_notes_for_pay_later', true);
    const updated = await status(t, 'washing');
    assert.equal(updated.phone_number, null); assert.equal(Number(updated.total_amount), 195);
    await setting('require_phone_number', false); await setting('require_pickup_date', false); await setting('require_notes_for_pay_later', false);
  });
  await test('add-on historical price survives catalog edits and order status changes', async () => {
    const addon = await one("insert into add_ons_catalog(name,price,unit_type) values ('Soap',10,'piece') returning id");
    let t = await transaction({ add_on_items: JSON.stringify([{add_on_id:addon.id,quantity:2}]), add_ons:20, total_amount:20 });
    await q('update add_ons_catalog set price=99 where id=$1', [addon.id]);
    t = await status(t, 'washing'); assert.equal(t.add_on_items[0].unit_price, 10);
    await q('update transactions set add_on_items=$1 where id=$2', [JSON.stringify([{add_on_id:addon.id,quantity:3}]),t.id]);
    assert.equal((await fresh(t.id)).add_on_items[0].unit_price, 10);
    const ml = await one("insert into add_ons_catalog(name,price,unit_type) values ('Liquid Detergent',2,'ml') returning id");
    const mlOrder = await transaction({ add_on_items: JSON.stringify([{add_on_id:ml.id,quantity:250}]), add_ons:500, total_amount:500 });
    assert.equal(mlOrder.add_on_items[0].unit_type, 'ml');
    const sachet = await one("insert into add_ons_catalog(name,price,unit_type) values ('Conditioner Sachet',3,'sachet') returning id");
    await assert.rejects(
      transaction({ add_on_items: JSON.stringify([{add_on_id:sachet.id,quantity:1.5}]), add_ons:4.5, total_amount:4.5 }),
      e => e.code === '22023' && e.message.includes('whole numbers'),
    );
  });
  await test('8 kg/load catalog and existing form calculation remain intact', async () => {
    assert.ok((await q('select * from services')).every(s => Number(s.max_kg_per_load) === 8));
    for (const path of ['src/components/TransactionForm.tsx','src/components/EditTransactionModal.tsx']) {
      const expression = (await read(path)).match(/Math\.ceil\(kg\s*\/\s*(?:service|selectedService)\.max_kg_per_load\)/)?.[0];
      assert.ok(expression, 'Existing form load calculation found');
      const calculate = new Function('kg', 'service', 'selectedService', `return ${expression}`);
      for (const [kg, expected] of [[1,1],[8,1],[8.01,2],[16,2],[17,3]]) {
        assert.equal(calculate(kg, {max_kg_per_load:8}, {max_kg_per_load:8}), expected);
      }
    }
  });
  await test('existing export columns and rate limiter dependency still available', async () => {
    await q('select transaction_no,transaction_code,transaction_date,customer_name,phone_number,kg,no_of_loads,base_amount,add_ons,add_on_items,total_amount,cash_amount,gcash_amount,gcash_reference,payment_method,pickup_date,pickup_time,notes,created_at from transactions where deleted_at is null');
    assert.ok((await one("select to_regprocedure('public.check_rate_limit(text,integer,integer)') is not null ok")).ok);
    assert.equal((await one("select has_function_privilege('service_role','public.check_rate_limit(text,integer,integer)','execute') ok")).ok, true);
  });
  await test('staff account UI/function wiring (source contract; behaviour is covered by the database and Edge tests)', async () => {
    const edgeFunction = await read('supabase/functions/manage-staff-user/index.ts');
    const manager = await read('src/components/StaffAccountsManager.tsx');
    const modal = await read('src/components/EditStaffAccountModal.tsx');
    const hook = await read('src/hooks/useStaffAccounts.ts');
    assert.match(edgeFunction, /ownerProfile\?\.role !== "owner"/);
    assert.match(edgeFunction, /ownerProfile\?\.is_active !== true/);
    assert.match(edgeFunction, /targetProfile\.role !== "staff"/);
    assert.equal(/deleteUser/.test(edgeFunction), false, 'hard delete removed from manage-staff-user');
    assert.equal(/onDelete|deleteStaff|>Delete</.test(manager), false, 'no Delete control remains in the UI');
    assert.match(manager, /Disable Account/); assert.match(manager, /Enable Account/);
    assert.match(manager, /action: 'disable'|'disable' \| 'enable'/);
    assert.equal(/from\('profiles'\)\.update/.test(modal), false, 'name-only edits no longer bypass the Edge Function');
    assert.match(modal, /invoke\('manage-staff-user'/);
    assert.match(hook, /email_lookup/); assert.match(manager, /emailNotice/);
    assert.match(modal, /New Temporary Password \(optional\)/);
  });
  await test('authenticated helper EXECUTE retained; anonymous RPC denied; realtime membership unique', async () => {
    const grants = await one("select has_function_privilege('authenticated','private.has_staff_permission(text)','execute') helper, has_function_privilege('anon','public.set_transaction_status(uuid,text,timestamptz,text,boolean)','execute') anon");
    assert.equal(grants.helper, true); assert.equal(grants.anon, false);
    for (const table of ['transactions','customers','transaction_status_history','transaction_customer_items','transaction_service_items']) {
      assert.equal((await q("select * from pg_publication_tables where pubname='supabase_realtime' and tablename=$1", [table])).length, 1);
    }
  });
  await test('same-transaction writes advance existing timestamp token', async () => {
    const t = await transaction();
    await db.exec('begin');
    const washing = await status(t, 'washing');
    const drying = await status(washing, 'drying');
    assert.notEqual(washing.token, drying.token);
    await db.exec('rollback');
    assert.equal((await fresh(t.id)).order_status, 'received');
    assert.equal((await q('select id from transaction_status_history where transaction_id=$1',[t.id])).length,1);
  });
  await test('raw staff soft-delete remains RLS-protected; RPC is required', async () => {
    await asUser(staff);
    const t = await transaction({ created_by:staff, customer_name:'Staff delete regression', phone_number:null });
    let code = null;
    let rows = [];
    try { rows = await q("update transactions set deleted_at=now(),delete_reason='Duplicate entry' where id=$1 returning id",[t.id]); }
    catch (error) { code = error.code; }
    assert.ok(code === '42501' || rows.length === 0);
    await asUser(owner);
  });
  await test('backfill dry run, conservative matching, ambiguity, snapshot preservation and rerun', async () => {
    // These fixtures represent pre-auto-link legacy rows; disable the forward
    // trigger while creating them so the backfill script is tested directly.
    await admin();
    await db.exec('drop trigger if exists transactions_00_resolve_customer on public.transactions');
    const safe = await transaction({ customer_name:'Unique Legacy',phone_number:'09201234567' });
    await transaction({ customer_name:'Shared One',phone_number:'09211234567' });
    await transaction({ customer_name:'Shared Two',phone_number:'+639211234567' });
    const missing = await transaction({ customer_name:'Unique Legacy',phone_number:null });
    const script = await read('supabase/scripts/backfill_customers.sql');
    await admin(); // Maintenance script needs table-lock privileges, not an API RPC.
    await db.exec(script); assert.equal((await fresh(safe.id)).customer_id, null);
    const result = await db.exec(script.replace(/rollback;\s*$/, 'commit;'));
    const report = result.find(r => r.rows?.[0]?.safely_linked_this_run !== undefined).rows[0];
    console.log('Backfill fixture report:', JSON.stringify(report));
    assert.equal(report.safely_linked_this_run, 1); assert.ok(report.ambiguous_phone_groups >= 1);
    const linked = await fresh(safe.id); assert.ok(linked.customer_id); assert.equal(linked.customer_name, safe.customer_name); assert.equal(linked.phone_number, safe.phone_number);
    assert.equal((await fresh(missing.id)).customer_id, null);
    assert.equal((await q("select id from transactions where customer_name like 'Shared%' and customer_id is not null")).length, 0);
    const again = await db.exec(script.replace(/rollback;\s*$/, 'commit;'));
    assert.equal(again.find(r => r.rows?.[0]?.safely_linked_this_run !== undefined).rows[0].safely_linked_this_run, 0);
  });
  // ── Staff account disable / enable (real database behaviour) ────────────────
  const owner2 = '00000000-0000-4000-8000-000000000003';
  const staff2 = '00000000-0000-4000-8000-000000000004';
  const ghost = '00000000-0000-4000-8000-0000000000ff';
  const errCode = async fn => { try { await fn(); return null; } catch (error) { return error.code ?? 'ERR:' + error.message; } };
  async function setActive(actor, target, active) {
    await asUser(null, 'service_role');
    try { return (await one('select public.set_staff_account_active($1,$2,$3) as r', [actor, target, active])).r; }
    finally { await admin(); }
  }
  const allStaffPermissions = ['create_transactions', 'access_dashboard', 'view_full_history', 'edit_transactions', 'delete_transactions', 'view_historical_pay_later', 'edit_own_profile', 'manage_customers'];
  const helperResults = async () => {
    const out = {};
    for (const p of allStaffPermissions) out[p] = (await one('select private.has_staff_permission($1) as ok', [p])).ok;
    return out;
  };
  await admin();
  await db.exec(`insert into auth.users(id,email) values ('${owner2}','owner2@test.local'), ('${staff2}','staff2@test.local'), ('${ghost}','ghost@test.local')`);
  await db.exec('alter table public.profiles disable trigger profiles_enforce_safe_self_update');
  await q("update public.profiles set role='owner' where id=$1", [owner2]);
  await db.exec('alter table public.profiles enable trigger profiles_enforce_safe_self_update');
  await q('delete from public.profiles where id=$1', [ghost]); // valid login, NO profile row
  for (const column of ['staff_can_create_transactions', 'staff_can_access_dashboard', 'staff_can_view_full_history', 'staff_can_edit_transactions', 'staff_can_delete_transactions', 'staff_can_view_historical_pay_later', 'staff_can_edit_own_profile', 'staff_can_manage_customers']) await setting(column, true);
  await asUser(owner);
  await q("insert into discounts_promos(name, discount_value, starts_at, ends_at) values ('Disable fixture promo', 10, now() - interval '1 day', now() + interval '30 days')");
  const readableTables = ['transactions', 'transaction_status_history', 'customers', 'services', 'add_ons_catalog', 'shop_settings', 'inventory_items', 'inventory_categories', 'discounts_promos', 'transaction_customer_items', 'customer_summary'];
  await asUser(staff);
  const staffTx = await transaction({ created_by: staff, customer_name: 'Disable history fixture', phone_number: null });
  await status(staffTx, 'washing');
  await asUser(owner);
  const historyOf = async () => ({
    tx: (await q('select id from transactions where created_by=$1 order by id', [staff])).map(r => r.id),
    hist: (await q('select id from transaction_status_history where changed_by=$1 order by id', [staff])).map(r => r.id),
  });
  const historyBefore = await historyOf();
  assert.ok(historyBefore.tx.length >= 1 && historyBefore.hist.length >= 1, 'fixture: staff has real transaction and status history');

  await test('active staff baseline: profile columns default active; every permission helper is true', async () => {
    const p = await one('select is_active, disabled_at, disabled_by from profiles where id=$1', [staff]);
    assert.deepEqual(p, { is_active: true, disabled_at: null, disabled_by: null });
    await asUser(staff);
    assert.ok(Object.values(await helperResults()).every(v => v === true));
    assert.ok((await q("select id from transactions where id=$1", [staffTx.id])).length === 1);
    // Non-vacuous fixture: an ACTIVE staff account really can read every table checked later.
    for (const table of readableTables) assert.ok((await q(`select 1 from ${table} limit 1`)).length === 1, `${table} has rows visible to active staff`);
    await asUser(owner);
  });

  await test('hard delete of a staff login with history is still blocked by foreign keys (why Disable replaces Delete)', async () => {
    await admin();
    assert.equal(await errCode(() => q('delete from auth.users where id=$1', [staff])), '23503');
    assert.equal((await one('select count(*)::int c from profiles where id=$1', [staff])).c, 1);
    await asUser(owner);
  });

  await test('Disable: sets state, revokes only the target sessions and refresh tokens, is idempotent', async () => {
    await admin();
    const s1 = (await one('insert into auth.sessions(user_id) values ($1) returning id', [staff])).id;
    const s2 = (await one('insert into auth.sessions(user_id) values ($1) returning id', [staff])).id;
    const o1 = (await one('insert into auth.sessions(user_id) values ($1) returning id', [owner])).id;
    const other = (await one('insert into auth.sessions(user_id) values ($1) returning id', [staff2])).id;
    for (const [uid, sid] of [[staff, s1], [staff, s2], [owner, o1], [staff2, other]]) await q('insert into auth.refresh_tokens(user_id, session_id) values ($1,$2)', [uid, sid]);
    await q("insert into auth.refresh_tokens(user_id, session_id) values ($1, null)", [staff]); // orphan token
    const result = await setActive(owner, staff, false);
    assert.equal(result.is_active, false);
    assert.ok(result.disabled_at);
    assert.equal(result.sessions_revoked, 2);
    const row = await one('select is_active, disabled_at, disabled_by from profiles where id=$1', [staff]);
    assert.equal(row.is_active, false); assert.ok(row.disabled_at); assert.equal(row.disabled_by, owner);
    assert.equal((await one('select count(*)::int c from auth.sessions where user_id=$1', [staff])).c, 0);
    assert.equal((await one('select count(*)::int c from auth.refresh_tokens where user_id=$1', [staff])).c, 0);
    assert.equal((await one('select count(*)::int c from auth.sessions where user_id=$1', [owner])).c, 1, 'Owner session untouched');
    assert.equal((await one('select count(*)::int c from auth.sessions where user_id=$1', [staff2])).c, 1, 'Other staff session untouched');
    assert.equal((await one('select count(*)::int c from auth.refresh_tokens where user_id=$1', [staff2])).c, 1);
    const again = await setActive(owner, staff, false);
    assert.equal(again.is_active, false); assert.equal(again.sessions_revoked, 0);
    assert.equal((await one('select disabled_by from profiles where id=$1', [staff])).disabled_by, owner);
  });

  await test('disabled staff with an unexpired JWT is denied by every permission helper', async () => {
    await asUser(staff);
    assert.ok(Object.values(await helperResults()).every(v => v === false), JSON.stringify(await helperResults()));
    assert.equal((await one("select private.is_owner() as v")).v, false);
    assert.equal((await one("select private.is_active_user() as v")).v, false);
    assert.equal((await one("select private.can_view_transaction(current_date, 'cash', null) as v")).v, false);
    await asUser(owner);
  });

  await test('disabled staff can no longer read business data or write anything', async () => {
    await asUser(staff);
    for (const table of readableTables) {
      assert.equal((await q(`select 1 from ${table} limit 1`)).length, 0, `${table} must be empty for a disabled account`);
    }
    assert.equal(await errCode(() => transaction({ created_by: staff, customer_name: 'Should be denied', phone_number: null })), '42501');
    assert.equal((await q("update transactions set customer_name='tampered' where id=$1 returning id", [staffTx.id])).length, 0);
    assert.equal(await errCode(() => status(staffTx, 'drying')), '42501');
    assert.equal(await errCode(() => softDelete(staffTx, 'Duplicate entry')), '42501');
    assert.equal(await errCode(() => customerItems(staffTx, [])), '42501');
    assert.equal((await q("update profiles set full_name='Disabled Rename' where id=$1 returning id", [staff])).length, 0);
    await asUser(owner);
    assert.notEqual((await one('select full_name from profiles where id=$1', [staff])).full_name, 'Disabled Rename');
  });

  await test('disabled staff can still read only their own profile row (so the app can show the disabled notice) and cannot re-enable', async () => {
    await asUser(staff);
    const own = await q('select id, is_active from profiles');
    assert.deepEqual(own.map(r => [r.id, r.is_active]), [[staff, false]]);
    assert.equal(await errCode(() => q('update profiles set is_active=true, disabled_at=null where id=$1', [staff])), '42501');
    await asUser(owner);
    assert.equal((await one('select is_active from profiles where id=$1', [staff])).is_active, false);
  });

  await test('Owner keeps full access and sees the disabled account history untouched', async () => {
    await asUser(owner);
    assert.deepEqual(await historyOf(), historyBefore);
    assert.equal((await q('select id from transactions where id=$1', [staffTx.id])).length, 1);
    assert.ok((await q('select id from profiles')).length >= 4);
  });

  await test('clients (Owner browser session, Staff, anon) cannot change account state or call the service RPC', async () => {
    await asUser(owner);
    assert.equal(await errCode(() => q('update profiles set is_active=true, disabled_at=null where id=$1', [staff])), '42501');
    assert.equal(await errCode(() => q('update profiles set disabled_by=null where id=$1', [staff])), '42501');
    const p = await one("select has_column_privilege('authenticated','public.profiles','is_active','UPDATE') a, has_column_privilege('authenticated','public.profiles','disabled_at','UPDATE') b, has_column_privilege('authenticated','public.profiles','disabled_by','UPDATE') c, has_column_privilege('authenticated','public.profiles','full_name','UPDATE') d");
    assert.deepEqual(p, { a: false, b: false, c: false, d: true });
    for (const role of ['authenticated', 'anon']) {
      await asUser(owner, role);
      assert.equal(await errCode(() => q('select public.set_staff_account_active($1,$2,$3)', [owner, staff2, false])), '42501', role);
    }
    await admin();
    assert.equal((await one("select has_function_privilege('service_role','public.set_staff_account_active(uuid,uuid,boolean)','execute') ok")).ok, true);
    // A trusted role may only touch the account-state columns, never other profile fields.
    await asUser(null, 'service_role');
    assert.equal(await errCode(() => q("update profiles set full_name='x' where id=$1", [staff2])), '42501');
    await asUser(owner);
  });

  await test('the account-state trigger blocks clients even if the column privilege were granted back', async () => {
    await admin();
    await db.exec('grant update (is_active, disabled_at, disabled_by) on public.profiles to authenticated');
    try {
      await asUser(owner);
      const failure = await (async () => { try { await q('update profiles set is_active=true, disabled_at=null where id=$1', [staff]); return null; } catch (error) { return error; } })();
      assert.equal(failure?.code, '42501');
      assert.match(failure.message, /staff account service/);
      assert.equal((await one('select is_active from profiles where id=$1', [staff])).is_active, false);
    } finally {
      await admin();
      await db.exec('revoke update (is_active, disabled_at, disabled_by) on public.profiles from authenticated');
      await asUser(owner);
    }
  });

  await test('Owner protection: owners cannot be disabled (including the acting Owner), even at the constraint level', async () => {
    assert.equal(await errCode(() => setActive(owner, owner2, false)), '42501');
    assert.equal(await errCode(() => setActive(owner, owner, false)), '42501');
    assert.equal(await errCode(() => setActive(owner2, owner, false)), '42501');
    assert.equal((await one("select count(*)::int c from profiles where role='owner' and is_active")).c, 2);
    await admin();
    assert.equal(await errCode(() => q("update profiles set is_active=false, disabled_at=now() where id=$1", [owner2])), '23514');
    await asUser(owner);
  });

  await test('defence in depth: even if the owner constraint were bypassed, an inactive Owner row has no Owner powers', async () => {
    await admin();
    const shell = '00000000-0000-4000-8000-000000000006';
    await db.exec(`insert into auth.users(id,email) values ('${shell}','shell-owner@test.local')`);
    await db.exec('alter table public.profiles disable trigger profiles_enforce_safe_self_update');
    await q("update profiles set role='owner' where id=$1", [shell]);
    await db.exec('alter table public.profiles enable trigger profiles_enforce_safe_self_update');
    await db.exec('alter table public.profiles drop constraint profiles_owner_always_active');
    await q("update profiles set is_active=false, disabled_at=now() where id=$1", [shell]);
    await asUser(shell);
    assert.equal((await one('select private.is_owner() v')).v, false);
    assert.equal((await q('select id from profiles')).length, 1);
    await admin();
    await q("update profiles set is_active=true, disabled_at=null where id=$1", [shell]);
    await db.exec("alter table public.profiles add constraint profiles_owner_always_active check (role <> 'owner' or is_active)");
    await q("delete from profiles where id=$1", [shell]);
    await asUser(owner);
  });

  await test('Staff (active or disabled) and unknown actors cannot authorize account changes', async () => {
    assert.equal(await errCode(() => setActive(staff2, staff, true)), '42501');
    assert.equal(await errCode(() => setActive(ghost, staff2, false)), '42501', 'actor without profile');
    assert.equal(await errCode(() => setActive('00000000-0000-4000-8000-0000000000aa', staff2, false)), '42501');
    assert.equal(await errCode(() => setActive(owner, '00000000-0000-4000-8000-0000000000aa', false)), 'P0002');
    assert.equal(await errCode(() => setActive(owner, null, false)), '22023');
    assert.equal(await errCode(() => setActive(owner, staff2, null)), '22023');
    assert.equal((await one('select is_active from profiles where id=$1', [staff2])).is_active, true);
  });

  await test('a disabled Staff profile cannot be promoted to Owner (constraint) and a disabled actor cannot authorize changes', async () => {
    await asUser(owner);
    assert.equal(await errCode(() => q("update profiles set role='owner' where id=$1", [staff])), '23514');
    assert.equal(await errCode(() => setActive(staff, staff2, false)), '42501', 'disabled staff as actor');
    await asUser(owner);
  });

  await test('an active Staff account cannot change roles, other profiles, or read other accounts', async () => {
    await asUser(staff2);
    assert.equal(await errCode(() => q("update profiles set role='owner' where id=$1", [staff2])), '42501');
    assert.equal((await q("update profiles set full_name='hacked' where id=$1 returning id", [owner])).length, 0);
    assert.deepEqual((await q('select id from profiles')).map(r => r.id), [staff2]);
    assert.equal((await one('select private.is_owner() v')).v, false);
    await asUser(owner);
  });

  await test('Enable/reactivation restores access; history and ledger are unchanged', async () => {
    const result = await setActive(owner, staff, true);
    assert.equal(result.is_active, true); assert.equal(result.disabled_at, null);
    assert.deepEqual(await one('select is_active, disabled_at, disabled_by from profiles where id=$1', [staff]), { is_active: true, disabled_at: null, disabled_by: null });
    await asUser(staff);
    assert.ok(Object.values(await helperResults()).every(v => v === true));
    assert.equal((await q('select id from transactions where id=$1', [staffTx.id])).length, 1);
    assert.ok((await q('select id from transaction_status_history where transaction_id=$1', [staffTx.id])).length >= 2);
    const created = await transaction({ created_by: staff, customer_name: 'After re-enable', phone_number: null });
    assert.equal(created.created_by, staff);
    await asUser(owner);
    const after = await historyOf();
    assert.ok(historyBefore.hist.every(id => after.hist.includes(id)), 'status history preserved');
    assert.ok(historyBefore.tx.every(id => after.tx.includes(id)), 'transactions preserved');
    assert.equal((await setActive(owner, staff, true)).is_active, true, 'enable is idempotent');
  });

  await test('sessions revoked on disable stay revoked after Enable (the user must sign in again)', async () => {
    await admin();
    assert.equal((await one('select count(*)::int c from auth.sessions where user_id=$1', [staff])).c, 0);
    assert.equal((await one('select count(*)::int c from auth.refresh_tokens where user_id=$1', [staff])).c, 0);
    await asUser(owner);
  });

  await test('a valid login with NO profile row gets nothing, even with every Staff default enabled', async () => {
    await asUser(ghost);
    assert.ok(Object.values(await helperResults()).every(v => v === false), JSON.stringify(await helperResults()));
    for (const table of readableTables) {
      assert.equal((await q(`select 1 from ${table} limit 1`)).length, 0, `${table} must be empty without a profile`);
    }
    assert.equal(await errCode(() => transaction({ created_by: ghost, customer_name: 'ghost write', phone_number: null })), '42501');
    assert.equal((await one("select private.can_view_transaction(current_date, 'cash', null) v")).v, false);
    await asUser(owner);
  });

  await test('revoke_staff_sessions signs a Staff user out everywhere without changing access; Owners/Staff/anon cannot use it', async () => {
    await admin();
    const t1 = (await one('insert into auth.sessions(user_id) values ($1) returning id', [staff2])).id;
    await q('insert into auth.refresh_tokens(user_id, session_id) values ($1,$2)', [staff2, t1]);
    const keep = (await one('insert into auth.sessions(user_id) values ($1) returning id', [owner])).id;
    const existing = (await one('select count(*)::int c from auth.sessions where user_id=$1', [staff2])).c;
    assert.ok(existing >= 1);
    await asUser(null, 'service_role');
    const r = (await one('select public.revoke_staff_sessions($1,$2) as r', [owner, staff2])).r;
    assert.equal(r.sessions_revoked, existing);
    assert.equal(await errCode(() => q('select public.revoke_staff_sessions($1,$2)', [owner, owner2])), '42501', 'Owner sessions are never revoked here');
    assert.equal(await errCode(() => q('select public.revoke_staff_sessions($1,$2)', [staff, staff2])), '42501', 'Staff cannot authorize');
    assert.equal(await errCode(() => q('select public.revoke_staff_sessions($1,$2)', [owner, '00000000-0000-4000-8000-0000000000aa'])), 'P0002');
    await admin();
    assert.equal((await one('select count(*)::int c from auth.sessions where user_id=$1', [staff2])).c, 0);
    assert.equal((await one('select count(*)::int c from auth.refresh_tokens where user_id=$1', [staff2])).c, 0);
    assert.equal((await one('select count(*)::int c from auth.sessions where id=$1', [keep])).c, 1);
    assert.equal((await one('select is_active from profiles where id=$1', [staff2])).is_active, true, 'access is unchanged');
    for (const role of ['authenticated', 'anon']) {
      await asUser(owner, role);
      assert.equal(await errCode(() => q('select public.revoke_staff_sessions($1,$2)', [owner, staff2])), '42501', role);
    }
    await asUser(owner);
  });

  await test('the last Owner still cannot be demoted (lock added to the trigger does not change the rule)', async () => {
    await asUser(owner);
    await q("update profiles set role='staff' where id=$1", [owner2]);
    assert.equal(await errCode(() => q("update profiles set role='staff' where id=$1", [owner])), 'P0001');
    assert.equal((await one("select count(*)::int c from profiles where role='owner'")).c, 1);
    await q("update profiles set role='owner' where id=$1", [owner2]);
    assert.equal((await one("select count(*)::int c from profiles where role='owner'")).c, 2);
  });

  await test('new logins get an active Staff profile (no manual step needed)', async () => {
    await admin();
    const fresh3 = '00000000-0000-4000-8000-000000000005';
    await db.exec(`insert into auth.users(id,email) values ('${fresh3}','new-staff@test.local')`);
    assert.deepEqual(await one('select role, is_active from profiles where id=$1', [fresh3]), { role: 'staff', is_active: true });
    await asUser(owner);
  });

  await asUser(owner);
  const wdfId = await serviceId('WDF');
  const csdbId = await serviceId('CSDB');
  async function createWithServices(primary, items) {
    return one('select * from public.create_transaction_with_service_items($1::jsonb, $2::jsonb)', [JSON.stringify(primary), JSON.stringify(items)]);
  }
  async function replaceServices(id, expectedUpdatedAt, primary, items) {
    return one('select * from public.replace_transaction_service_items($1,$2,$3::jsonb,$4::jsonb)', [id, expectedUpdatedAt, JSON.stringify(primary), JSON.stringify(items)]);
  }
  function multiServicePrimary(overrides = {}) {
    return {
      customer_name: 'Multi Service Customer',
      phone_number: null,
      transaction_date: '2026-09-25',
      service_id: wdfId,
      detergent_source: 'customer_supplied',
      detergent_other_reason: 'Customer-provided detergent',
      fabric_conditioner_source: 'customer_supplied',
      fabric_conditioner_other_reason: 'Customer-provided fabric conditioner',
      kg: 8, no_of_loads: 1, base_amount: 195, add_ons: 0, add_on_items: [],
      total_amount: 195, cash_amount: 0, gcash_amount: 0, payment_method: 'pay_later',
      ...overrides,
    };
  }
  const csdbLine = (overrides = {}) => ({ service_id: csdbId, kg: 8, no_of_loads: 1, base_amount: 220, add_on_items: [], ...overrides });

  await test('create_transaction_with_service_items: one order, one payment, grand total across services (cash)', async () => {
    const created = await createWithServices(
      multiServicePrimary({ payment_method: 'paid', cash_amount: 415, total_amount: 195 }),
      [csdbLine()],
    );
    assert.equal(Number(created.total_amount), 415, 'grand total = primary (195) + additional service (220)');
    assert.equal(Number(created.base_amount), 195, 'primary base_amount keeps its existing, primary-only meaning');
    assert.equal(Number(created.cash_amount), 415);
    const lines = await q('select * from transaction_service_items where transaction_id=$1 order by position', [created.id]);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].service_id, csdbId);
    assert.equal(lines[0].service_code_snapshot, 'CSDB');
    assert.equal(lines[0].service_label_snapshot, 'Comforter / Special Item');
    assert.equal(Number(lines[0].total_amount), 220);

    // Cash sufficiency is a per-statement CHECK against the final total_amount
    // (the whole order), not just the primary service's own subtotal.
    await assert.rejects(
      createWithServices(multiServicePrimary({ payment_method: 'paid', cash_amount: 195, total_amount: 195 }), [csdbLine()]),
      e => e.code === '23514',
    );
  });

  await test('create_transaction_with_service_items: GCash must equal the grand total, not just the primary', async () => {
    const created = await createWithServices(
      multiServicePrimary({ payment_method: 'gcash', gcash_amount: 415, gcash_reference: 'MULTI-GCASH-1', total_amount: 195 }),
      [csdbLine()],
    );
    assert.equal(Number(created.total_amount), 415);
    assert.equal(Number(created.gcash_amount), 415);

    await assert.rejects(
      createWithServices(
        multiServicePrimary({ payment_method: 'gcash', gcash_amount: 195, gcash_reference: 'MULTI-GCASH-2', total_amount: 195 }),
        [csdbLine()],
      ),
      e => e.code === '23514',
    );
  });

  await test('enforce_transaction_shop_preferences folds line totals into the manual-override check (create and edit)', async () => {
    await setting('allow_manual_total_override', false);

    await assert.rejects(
      createWithServices(multiServicePrimary({ total_amount: 999 }), [csdbLine()]),
      e => e.code === 'P0001' && e.message.includes('Manual Total override is disabled'),
    );

    const created = await createWithServices(multiServicePrimary({ total_amount: 195 }), [csdbLine()]);
    assert.equal(Number(created.total_amount), 415);

    // This is the direct regression test for the sequencing fix: the child
    // rows are replaced BEFORE replace_transaction_service_items' single
    // UPDATE runs, so by the time that UPDATE is checked, the "Base +
    // Add-ons + lines" subquery already reflects the NEW line total. A
    // correct grand total must still be accepted (it was wrongly rejected
    // before the two UPDATE statements were collapsed into one).
    const edited = await replaceServices(created.id, created.updated_at, multiServicePrimary({ total_amount: 195 }), [csdbLine({ base_amount: 250 })]);
    assert.equal(Number(edited.total_amount), 445, '195 primary + 250 updated line total');

    await assert.rejects(
      replaceServices(edited.id, edited.updated_at, multiServicePrimary({ total_amount: 999 }), [csdbLine({ base_amount: 250 })]),
      e => e.code === 'P0001' && e.message.includes('Manual Total override is disabled'),
    );

    await setting('allow_manual_total_override', true);
  });

  await test('replace_transaction_service_items can add services to a plain single-service order, then remove them', async () => {
    const plain = await transaction({ customer_name: 'Starts single service', phone_number: null, service_id: wdfId, base_amount: 195, total_amount: 195, payment_method: 'pay_later' });
    assert.equal((await q('select id from transaction_service_items where transaction_id=$1', [plain.id])).length, 0);

    const withLine = await replaceServices(plain.id, plain.token, multiServicePrimary({ total_amount: 195 }), [csdbLine()]);
    assert.equal(Number(withLine.total_amount), 415);
    assert.equal((await q('select id from transaction_service_items where transaction_id=$1', [plain.id])).length, 1);

    const backToSingle = await replaceServices(withLine.id, withLine.updated_at, multiServicePrimary({ total_amount: 195 }), []);
    assert.equal(Number(backToSingle.total_amount), 195, 'removing every additional line reverts to the primary-only total');
    assert.equal((await q('select id from transaction_service_items where transaction_id=$1', [plain.id])).length, 0);
  });

  await test('replace_transaction_service_items enforces concurrency, permissions, and blocks completed/cancelled orders', async () => {
    const t = await transaction({ customer_name: 'Concurrency guard', phone_number: null, service_id: wdfId, base_amount: 195, total_amount: 195, payment_method: 'pay_later' });
    await assert.rejects(
      replaceServices(t.id, '2000-01-01T00:00:00.000000Z', multiServicePrimary({ total_amount: 195 }), []),
      e => e.code === '40001',
    );

    let completed = await transaction({ customer_name: 'Completed services guard', phone_number: null, service_id: wdfId, base_amount: 195, total_amount: 195 });
    await customerItems(completed, [{ item_type: 'towels', quantity: 1 }]);
    completed = await status(completed, 'washing');
    completed = await status(completed, 'drying');
    completed = await status(completed, 'ready_for_pickup');
    completed = await status(completed, 'completed');
    await assert.rejects(
      replaceServices(completed.id, completed.updated_at, multiServicePrimary({ total_amount: 195 }), [csdbLine()]),
      e => e.code === '42501' && e.message.includes('completed'),
    );

    await setting('staff_can_create_transactions', false);
    await setting('staff_can_edit_transactions', false);
    await asUser(staff);
    const staffTarget = await fresh(t.id);
    await assert.rejects(
      replaceServices(staffTarget.id, staffTarget.token, multiServicePrimary({ total_amount: 195 }), [csdbLine()]),
      e => e.code === '42501',
    );
    await assert.rejects(
      createWithServices(multiServicePrimary({ total_amount: 195 }), [csdbLine()]),
      e => e.code === '42501',
    );
    await asUser(owner);
    await setting('staff_can_create_transactions', true);
    await setting('staff_can_edit_transactions', true);
  });

  await test('per-line inventory consumption fires on completion, and insufficient stock blocks it', async () => {
    await admin();
    const ensureCategory = async (name) => {
      const existing = await one('select id from inventory_categories where lower(name)=lower($1) limit 1', [name]);
      if (existing) return existing.id;
      return (await one('insert into inventory_categories (name, created_by, updated_by) values ($1,$2,$2) returning id', [name, owner])).id;
    };
    const detergentCategoryId = await ensureCategory('Liquid Detergent');
    const detergentItem = await one(
      `insert into public.inventory_items (item_name, category_id, unit_label, average_cost, created_by, updated_by)
       values ('Service Line Detergent', $1, 'ml', 2, $2, $2) returning id`,
      [detergentCategoryId, owner],
    );
    await q(
      `insert into public.inventory_stock_movements (item_id, movement_type, quantity_delta, unit_cost, reason, created_by)
       values ($1, 'stock_in', 1000, 2, 'Service line fixture', $2)`,
      [detergentItem.id, owner],
    );
    await asUser(owner);

    let order = await createWithServices(
      multiServicePrimary({ total_amount: 195 }),
      [csdbLine({ detergent_source: 'inventory', detergent_item_id: detergentItem.id, detergent_quantity: 40 })],
    );
    order.token = order.updated_at; // create_transaction_with_service_items returns public.transactions, not the token-aliased shape status() expects
    await customerItems(order, [{ item_type: 'towels', quantity: 1 }]);
    order = await status(order, 'washing');
    order = await status(order, 'drying');
    order = await status(order, 'ready_for_pickup');
    order = await status(order, 'completed');

    const line = await one('select * from transaction_service_items where transaction_id=$1', [order.id]);
    const consumption = await one('select * from transaction_service_item_inventory_consumption where service_item_id=$1', [line.id]);
    assert.ok(consumption.detergent_movement_id, 'a consumption movement was recorded for the additional service line');
    const stock = await one('select coalesce(sum(quantity_delta),0)::numeric as total from inventory_stock_movements where item_id=$1', [detergentItem.id]);
    assert.equal(Number(stock.total), 1000 - 40);

    let shortOrder = await createWithServices(
      multiServicePrimary({ total_amount: 195 }),
      [csdbLine({ detergent_source: 'inventory', detergent_item_id: detergentItem.id, detergent_quantity: 100000 })],
    );
    shortOrder.token = shortOrder.updated_at;
    await customerItems(shortOrder, [{ item_type: 'towels', quantity: 1 }]);
    shortOrder = await status(shortOrder, 'washing');
    shortOrder = await status(shortOrder, 'drying');
    shortOrder = await status(shortOrder, 'ready_for_pickup');
    await assert.rejects(status(shortOrder, 'completed'), e => e.code === '23514' && e.message.includes('Insufficient'));
  });

  await test('transaction_service_items RLS: anon denied, and direct inserts require the same permissions as the RPCs', async () => {
    const t = await transaction({ customer_name: 'Direct insert guard', phone_number: null, service_id: wdfId, base_amount: 195, total_amount: 195, payment_method: 'pay_later' });
    await setting('staff_can_create_transactions', false);
    await setting('staff_can_edit_transactions', false);
    await asUser(staff);
    await rejects(
      'insert into transaction_service_items (transaction_id, service_id, base_amount) values ($1,$2,$3)',
      [t.id, csdbId, 220],
      '42501',
    );
    await asUser(owner);
    await setting('staff_can_create_transactions', true);
    await setting('staff_can_edit_transactions', true);

    await asUser(null, 'anon');
    await rejects('select * from transaction_service_items', [], '42501');
    await rejects(
      'select * from public.create_transaction_with_service_items($1::jsonb, $2::jsonb)',
      [JSON.stringify(multiServicePrimary({ total_amount: 195 })), JSON.stringify([csdbLine()])],
      '42501',
    );
    await asUser(owner);
  });

  console.log(`\n${passed} PASS; 0 FAIL. NOT RUN: multi-session contention, Supabase API/Realtime transport, external n8n export.`);
} finally { await db.close(); }
