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
async function status(t, next, reason = null, override = false) {
  return one('select *, updated_at::text as token from public.set_transaction_status($1,$2,$3,$4,$5)', [t.id, next, t.token, reason, override]);
}
async function customerItems(t, items) {
  return q('select * from public.save_transaction_customer_items($1,$2::jsonb)', [t.id, JSON.stringify(items)]);
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
  await test('customer item workflow enforces validation, permissions, completion, and history', async () => {
    const grants = await one("select has_function_privilege('authenticated','public.save_transaction_customer_items(uuid,jsonb)','execute') auth_ok, has_function_privilege('anon','public.save_transaction_customer_items(uuid,jsonb)','execute') anon_ok");
    assert.equal(grants.auth_ok, true); assert.equal(grants.anon_ok, false);
    assert.equal((await q("select * from pg_publication_tables where pubname='supabase_realtime' and tablename='transaction_customer_items'")).length, 1);
    const empty = await transaction({ customer_name: 'No item list yet', phone_number: null });
    assert.equal((await q('select id from transaction_customer_items where transaction_id=$1', [empty.id])).length, 0);
    await asUser(staff);
    const staffOrder = await transaction({ created_by: staff, customer_name: 'Staff clothing items', phone_number: null });
    assert.equal((await customerItems(staffOrder, [{ item_type: 'shorts', quantity: 2 }, { item_type: 'other', quantity: 1, custom_item_name: 'Blanket' }])).length, 2);
    await asUser(owner);
    assert.equal((await customerItems(staffOrder, [{ item_type: 'shorts', quantity: 4 }, { item_type: 'towels', quantity: 3 }])).length, 2);
    assert.equal((await one("select quantity from transaction_customer_items where transaction_id=$1 and item_type='shorts'", [staffOrder.id])).quantity, 4);
    assert.equal((await q('select item_type from transaction_customer_items where transaction_id=$1', [staffOrder.id])).length, 2);
    await assert.rejects(customerItems(staffOrder, [{ item_type: 'shorts', quantity: 0 }]), e => e.code === '22023');
    await assert.rejects(customerItems(staffOrder, [{ item_type: 'other', quantity: 1 }]), e => e.code === '22023');
    await assert.rejects(customerItems(staffOrder, [{ item_type: 'shorts', quantity: 1 }, { item_type: 'shorts', quantity: 2 }]), e => e.code === '22023');
    let blocked = await transaction({ customer_name: 'Blocked completion', phone_number: null });
    blocked = await status(blocked, 'washing'); blocked = await status(blocked, 'drying'); blocked = await status(blocked, 'ready_for_pickup');
    await assert.rejects(status(blocked, 'completed'), e => e.code === '23514' && e.message.includes("Please record the customer's item list before completing this order."));
    await customerItems(blocked, [{ item_type: 'pants', quantity: 1 }]);
    blocked = await status(await fresh(blocked.id), 'completed');
    assert.equal(blocked.order_status, 'completed');
    assert.equal((await q('select id from transaction_customer_items where transaction_id=$1', [blocked.id])).length, 1);
    await assert.rejects(customerItems(blocked, [{ item_type: 'pants', quantity: 2 }]), e => e.code === '42501');
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
  let flow = await transaction();
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
    let resumed = await transaction({ created_by: staff, customer_name: 'Hold resume lifecycle' });
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
    let skip3 = await transaction({ created_by: staff, customer_name: 'Skip drying to complete' });
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
    assert.equal(cash.payment_method, 'paid');
    await transaction({ payment_method: 'gcash', base_amount: 100, total_amount: 100, gcash_amount: 100, gcash_reference: 'QA-GCASH-1' });
    await assert.rejects(transaction({ payment_method: 'gcash', total_amount: 100, gcash_amount: 100 }), e => e.code === '23514');
    await assert.rejects(transaction({ payment_method: 'paid', total_amount: 100, cash_amount: 99 }), e => e.code === '23514');
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
  });
  await test('authenticated helper EXECUTE retained; anonymous RPC denied; realtime membership unique', async () => {
    const grants = await one("select has_function_privilege('authenticated','private.has_staff_permission(text)','execute') helper, has_function_privilege('anon','public.set_transaction_status(uuid,text,timestamptz,text,boolean)','execute') anon");
    assert.equal(grants.helper, true); assert.equal(grants.anon, false);
    for (const table of ['transactions','customers','transaction_status_history','transaction_customer_items']) {
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
  console.log(`\n${passed} PASS; 0 FAIL. NOT RUN: multi-session contention, Supabase API/Realtime transport, external n8n export.`);
} finally { await db.close(); }
