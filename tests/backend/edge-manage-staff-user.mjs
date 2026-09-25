// Behaviour tests for the real Edge Function source files.
//
// The functions run unmodified (only the Deno-specific import specifiers are
// rewritten) against a local mock of the Supabase HTTP APIs, called through the
// real @supabase/supabase-js client from the repo's root node_modules. No
// network, production URL or credential is used: everything is 127.0.0.1.
//
// Scope: authorization, call ORDER and failure handling of the functions.
// The SQL that actually disables profiles / revokes sessions is exercised
// against real migrations in test.mjs (PGlite); the mock RPC below mirrors that
// function's documented contract and is NOT a substitute for it.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const O1 = 'aaaaaaaa-0000-4000-8000-000000000001', O2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const S1 = 'bbbbbbbb-0000-4000-8000-000000000001', S2 = 'bbbbbbbb-0000-4000-8000-000000000002', S3 = 'bbbbbbbb-0000-4000-8000-000000000003';
const GHOST = 'cccccccc-0000-4000-8000-000000000009';
const ANON = 'anon-key', SERVICE = 'service-key';
const tokens = { 'tok-o1': O1, 'tok-o2': O2, 'tok-s1': S1, 'tok-s3': S3 };

const state = { users: {}, profiles: {}, sessions: {}, calls: [], flags: {} };
const profile = (id, name, role, created, extra = {}) => ({ id, full_name: name, role, contact_phone: null, avatar_path: null, created_at: created, is_active: true, disabled_at: null, disabled_by: null, ...extra });
const reset = () => {
  state.users = {
    [O1]: { id: O1, email: 'owner1@test.local', user_metadata: { full_name: 'QA Owner One' } },
    [O2]: { id: O2, email: 'owner2@test.local', user_metadata: { full_name: 'QA Owner Two' } },
    [S1]: { id: S1, email: 's1@test.local', user_metadata: { full_name: 'QA Staff One', keep: 'me' } },
    [S2]: { id: S2, email: 's2@test.local', user_metadata: { full_name: 'QA Staff Two' } },
    [S3]: { id: S3, email: 's3@test.local', user_metadata: { full_name: 'QA Staff Three' } },
  };
  state.profiles = {
    [O1]: profile(O1, 'QA Owner One', 'owner', '2026-01-01T00:00:00Z'),
    [O2]: profile(O2, 'QA Owner Two', 'owner', '2026-01-02T00:00:00Z'),
    [S1]: profile(S1, 'QA Staff One', 'staff', '2026-01-03T00:00:00Z'),
    [S2]: profile(S2, 'QA Staff Two', 'staff', '2026-01-04T00:00:00Z'),
    [S3]: profile(S3, 'QA Staff Three', 'staff', '2026-01-05T00:00:00Z', { is_active: false, disabled_at: '2026-02-01T00:00:00Z' }),
  };
  state.sessions = { [S1]: 2, [S2]: 1, [O1]: 1 };
  state.calls = [];
  state.flags = {};
  state.revokeCalls = 0;
};

// Mirrors public.set_staff_account_active (contract only; real SQL is in test.mjs).
function rpcSetActive({ p_actor, p_target, p_active }) {
  const actor = state.profiles[p_actor];
  if (!actor || actor.role !== 'owner' || !actor.is_active) return [403, { code: '42501', message: 'Only an active Owner can change account access' }];
  const target = state.profiles[p_target];
  if (!target) return [404, { code: 'P0002', message: 'Staff account not found' }];
  if (target.role !== 'staff') return [403, { code: '42501', message: 'Owner accounts cannot be disabled or enabled here' }];
  let revoked = 0;
  if (p_active) Object.assign(target, { is_active: true, disabled_at: null, disabled_by: null });
  else { Object.assign(target, { is_active: false, disabled_at: '2026-09-29T00:00:00Z', disabled_by: p_actor }); revoked = state.sessions[p_target] ?? 0; state.sessions[p_target] = 0; }
  return [200, { user_id: p_target, is_active: target.is_active, disabled_at: target.disabled_at, sessions_revoked: revoked }];
}

const server = http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const body = chunks.length ? (() => { try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { return null; } })() : null;
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
    const who = bearer === SERVICE ? 'service' : bearer === ANON ? 'anon' : tokens[bearer] ? `user:${tokens[bearer]}` : 'unknown';
    const send = (status, obj, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    state.calls.push({ m: req.method, p: url.pathname, q: url.search, who, body });
    const p = url.pathname;
    if (p === '/auth/v1/user') { const id = tokens[bearer]; if (!id || !state.users[id]) return send(401, { code: 401, msg: 'invalid JWT' }); return send(200, { ...state.users[id], aud: 'authenticated' }); }
    if (p.startsWith('/auth/v1/admin/users')) {
      if (who !== 'service') return send(403, { msg: 'not_admin' });
      const id = p.split('/')[5];
      if (!id && req.method === 'GET') {
        if (state.flags.listUsersFails) return send(500, { msg: 'Auth lookup failed' });
        const page = Number(url.searchParams.get('page') || 1), perPage = Number(url.searchParams.get('per_page') || 50);
        const all = state.flags.listNeverEnds ? [Object.values(state.users)[0]] : Object.values(state.users);
        if (state.flags.listNeverEnds) return send(200, { users: all, aud: 'authenticated' });
        return send(200, { users: all.slice((page - 1) * perPage, page * perPage), aud: 'authenticated' });
      }
      if (!id && req.method === 'POST') {
        if (state.flags.createUserFails) return send(422, { msg: 'A user with this email address has already been registered', code: 'email_exists' });
        const created = { id: 'dddddddd-0000-4000-8000-000000000001', email: body.email, user_metadata: body.user_metadata };
        state.users[created.id] = created; return send(200, created);
      }
      if (req.method === 'GET') return state.users[id] ? send(200, state.users[id]) : send(404, { msg: 'User not found', code: 'user_not_found' });
      if (req.method === 'PUT') {
        if (!state.users[id]) return send(404, { msg: 'User not found' });
        if (Object.hasOwn(body, 'ban_duration')) {
          if (body.ban_duration === 'none' && state.flags.unbanFails) return send(500, { msg: 'Unban failed' });
          if (body.ban_duration !== 'none' && state.flags.banFails) return send(500, { msg: 'Ban failed' });
        } else if (state.flags.authUpdateFails) return send(422, { msg: 'A user with this email address has already been registered', code: 'email_exists' });
        const u = state.users[id];
        if (body.email) u.email = body.email;
        if (body.user_metadata) u.user_metadata = body.user_metadata;
        if (body.password) u.password = body.password;
        if (Object.hasOwn(body, 'ban_duration')) u.banned_until = body.ban_duration === 'none' ? null : new Date(Date.now() + 876000 * 3600e3).toISOString();
        return send(200, u);
      }
      if (req.method === 'DELETE') { delete state.users[id]; delete state.profiles[id]; return send(200, {}); }
    }
    if (p === '/rest/v1/rpc/set_staff_account_active') {
      if (who !== 'service') return send(403, { code: '42501', message: 'permission denied for function set_staff_account_active' });
      state.rpcCount = (state.rpcCount ?? 0) + 1;
      if (state.flags.rpcFailsAtCall === state.rpcCount || state.flags.rpcAlwaysFails) return send(500, { code: 'XX000', message: 'database unavailable' });
      const [status, result] = rpcSetActive(body);
      return send(status, result);
    }
    if (p === '/rest/v1/rpc/revoke_staff_sessions') {
      if (who !== 'service') return send(403, { code: '42501', message: 'permission denied for function revoke_staff_sessions' });
      if (state.flags.revokeFails) return send(500, { code: 'XX000', message: 'database unavailable' });
      const actor = state.profiles[body.p_actor], target = state.profiles[body.p_target];
      if (!actor || actor.role !== 'owner' || !actor.is_active) return send(403, { code: '42501', message: 'Only an active Owner can revoke sessions' });
      if (!target) return send(404, { code: 'P0002', message: 'Staff account not found' });
      if (target.role !== 'staff') return send(403, { code: '42501', message: 'Owner sessions cannot be revoked here' });
      const revoked = state.sessions[body.p_target] ?? 0; state.sessions[body.p_target] = 0; state.revokeCalls = (state.revokeCalls ?? 0) + 1;
      return send(200, { user_id: body.p_target, sessions_revoked: revoked });
    }
    if (p === '/rest/v1/rpc/check_rate_limit') return send(200, state.flags.rateLimited ? false : true);
    if (p === '/rest/v1/profiles') {
      const idEq = (url.searchParams.get('id') || '').replace(/^eq\./, '');
      const accept = req.headers.accept || '';
      if (req.method === 'GET') {
        if (state.flags.profileReadFails) return send(500, { message: 'profiles read failed', code: 'XX000' });
        if (state.flags.profileListFails && !idEq) return send(500, { message: 'profiles list failed', code: 'XX000' });
        let rows = Object.values(state.profiles); if (idEq) rows = rows.filter(r => r.id === idEq);
        if (accept.includes('vnd.pgrst.object')) return rows.length === 1 ? send(200, rows[0]) : send(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` });
        return send(200, rows);
      }
      if (req.method === 'PATCH') {
        if (state.flags.profilePatchFails) return send(403, { code: '42501', message: 'row-level security policy violation' });
        const caller = tokens[bearer]; const ownerActive = caller && state.profiles[caller]?.role === 'owner' && state.profiles[caller]?.is_active;
        if (ownerActive && state.profiles[idEq]) Object.assign(state.profiles[idEq], body);
        return send(204);
      }
      if (req.method === 'POST') { state.upserts = [...(state.upserts ?? []), body]; if (state.flags.profileUpsertFails) return send(500, { code: 'XX000', message: 'insert failed' }); return send(201); }
    }
    send(404, { msg: 'unmocked ' + req.method + ' ' + p });
  });
});

await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const env = { SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE };
const tmpDir = new URL('./.edge-tmp/', import.meta.url);
const handlers = {};
async function load(name) {
  const source = (await readFile(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8'))
    .replace(/^import "jsr:[^\n]*\n/m, '')
    .replace('npm:@supabase/supabase-js@2', '@supabase/supabase-js');
  await mkdir(tmpDir, { recursive: true });
  const file = new URL(`./${name}.mts`, tmpDir);
  await writeFile(file, source);
  globalThis.Deno = { serve: handler => { handlers[name] = handler; }, env: { get: key => env[key] } };
  await import(file.href);
  assert.equal(typeof handlers[name], 'function', `${name} registered a handler`);
}

let passed = 0;
async function test(name, fn) {
  try { reset(); state.rpcCount = 0; state.revokeCalls = 0; state.upserts = []; await fn(); console.log(`PASS ${name}`); passed++; }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); throw error; }
}
async function call(name, token, body, { headers = {}, method = 'POST', raw } = {}) {
  state.calls = [];
  const h = { 'content-type': 'application/json', ...headers };
  if (token) h.Authorization = token.startsWith('Basic') ? token : `Bearer ${token}`;
  const response = await handlers[name](new Request(`http://fn/${name}`, { method, headers: h, body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined }));
  let json = null; try { json = await response.json(); } catch { /* empty body */ }
  return { status: response.status, body: json, headers: response.headers, calls: [...state.calls] };
}
const manage = (token, body, options) => call('manage-staff-user', token, body, options);
const create = (token, body, options) => call('create-staff-user', token, body, options);
const isMutation = c => (c.p.startsWith('/auth/v1/admin/users') && ['PUT', 'DELETE', 'POST'].includes(c.m)) || (c.p === '/rest/v1/profiles' && ['PATCH', 'POST'].includes(c.m)) || c.p === '/rest/v1/rpc/set_staff_account_active' || c.p === '/rest/v1/rpc/revoke_staff_sessions';
const mutations = calls => calls.filter(isMutation);
const adminCalls = calls => calls.filter(c => c.p.startsWith('/auth/v1/admin') || c.p.startsWith('/rest/v1/rpc'));
const sequence = calls => calls.filter(isMutation).map(c => c.p.startsWith('/rest/v1/rpc') ? `rpc:${c.body.p_active ? 'enable' : 'disable'}` : c.body && Object.hasOwn(c.body, 'ban_duration') ? `ban:${c.body.ban_duration}` : `${c.m}:${c.p}`);

try {
  await load('manage-staff-user');
  await load('create-staff-user');

  // ── Authentication and authorization ───────────────────────────────────────
  await test('no Authorization header or non-Bearer scheme -> 401 with no service-role call', async () => {
    let r = await manage(null, { action: 'list' }); assert.equal(r.status, 401); assert.equal(adminCalls(r.calls).length, 0);
    r = await manage('Basic abc', { action: 'list' }); assert.equal(r.status, 401);
  });
  await test('invalid/expired token -> 401 and only the token check is made', async () => {
    const r = await manage('tok-bad', { action: 'list' });
    assert.equal(r.status, 401); assert.ok(r.calls.every(c => c.p === '/auth/v1/user'));
  });
  await test('Staff token is refused for EVERY action (incl. disable/enable/delete) with no mutation or Auth admin call', async () => {
    for (const action of ['list', 'update', 'delete', 'disable', 'enable', 'bogus']) {
      reset();
      const r = await manage('tok-s1', { action, user_id: S2, full_name: 'X', email: 'x@y.zz', password: 'password1' });
      assert.equal(r.status, 403, action); assert.equal(mutations(r.calls).length, 0, action); assert.equal(adminCalls(r.calls).length, 0, action);
      assert.equal(state.profiles[S2].is_active, true); assert.ok(state.users[S2]);
    }
  });
  await test('Staff cannot disable an Owner or themselves', async () => {
    let r = await manage('tok-s1', { action: 'disable', user_id: O1 }); assert.equal(r.status, 403); assert.equal(state.profiles[O1].is_active, true);
    r = await manage('tok-s1', { action: 'disable', user_id: S1 }); assert.equal(r.status, 403); assert.equal(state.profiles[S1].is_active, true);
  });
  await test('a demoted Owner, an Owner without a profile, and a DISABLED account are refused immediately', async () => {
    state.profiles[O1].role = 'staff'; let r = await manage('tok-o1', { action: 'list' }); assert.equal(r.status, 403);
    reset(); delete state.profiles[O1]; r = await manage('tok-o1', { action: 'list' }); assert.equal(r.status, 403);
    reset(); state.profiles[O1].is_active = false; r = await manage('tok-o1', { action: 'list' }); assert.equal(r.status, 403);
    reset(); r = await manage('tok-s3', { action: 'list' }); assert.equal(r.status, 403); // disabled staff JWT still cryptographically valid
    reset(); state.flags.profileReadFails = true; r = await manage('tok-o1', { action: 'list' }); assert.equal(r.status, 403);
  });

  // ── List ──────────────────────────────────────────────────────────────────
  await test('Owner list: accounts with email, active state, sign-in status; no secrets; service key used for lookups', async () => {
    state.users[S3].banned_until = new Date(Date.now() + 1e9).toISOString();
    const r = await manage('tok-o1', { action: 'list' });
    assert.equal(r.status, 200); assert.equal(r.body.email_lookup, 'ok'); assert.equal(r.body.accounts.length, 5);
    const s1 = r.body.accounts.find(a => a.id === S1), s3 = r.body.accounts.find(a => a.id === S3);
    assert.equal(s1.email, 's1@test.local'); assert.equal(s1.is_active, true); assert.equal(s1.sign_in_blocked, false);
    assert.equal(s3.is_active, false); assert.ok(s3.disabled_at); assert.equal(s3.sign_in_blocked, true);
    assert.ok(!JSON.stringify(r.body).match(/password|encrypted|hash/i));
    assert.ok(r.calls.filter(c => c.p === '/auth/v1/user').every(c => c.who === 'user:' + O1));
    assert.ok(r.calls.filter(c => c.p === '/rest/v1/profiles' || c.p.startsWith('/auth/v1/admin')).every(c => c.who === 'service'));
  });
  await test('Auth email lookup failure: still 200, explicit email_lookup=unavailable, blank emails, unknown sign-in status', async () => {
    state.flags.listUsersFails = true;
    const r = await manage('tok-o1', { action: 'list' });
    assert.equal(r.status, 200); assert.equal(r.body.email_lookup, 'unavailable');
    assert.equal(r.body.accounts.length, 5);
    assert.ok(r.body.accounts.every(a => a.email === '' && a.sign_in_blocked === null));
  });
  await test('list pages through more than 1000 Auth users (emails not silently dropped)', async () => {
    for (let i = 0; i < 1100; i++) state.users[`eeeeeeee-0000-4000-8000-${String(i).padStart(12, '0')}`] = { id: `eeeeeeee-0000-4000-8000-${String(i).padStart(12, '0')}`, email: `bulk${i}@test.local`, user_metadata: {} };
    state.users[S2].email = 'late@test.local'; const s2 = state.users[S2]; delete state.users[S2]; state.users[S2] = s2; // S2 now sits after the first page
    const r = await manage('tok-o1', { action: 'list' });
    assert.equal(r.status, 200); assert.equal(r.body.email_lookup, 'ok');
    assert.equal(r.body.accounts.find(a => a.id === S2).email, 'late@test.local');
    assert.equal(r.calls.filter(c => c.p === '/auth/v1/admin/users' && c.m === 'GET').length, 3, 'pages until an empty page');
  });
  await test('list never trusts a short page as the last one, and reports an incomplete lookup instead of guessing', async () => {
    state.flags.listNeverEnds = true;
    const r = await manage('tok-o1', { action: 'list' });
    assert.equal(r.status, 200); assert.equal(r.body.email_lookup, 'unavailable');
    assert.ok(r.body.accounts.every(a => a.email === '' && a.sign_in_blocked === null));
  });
  await test('a profile with no Auth user is reported as unknown (null), not as "not blocked"', async () => {
    delete state.users[S2];
    const r = await manage('tok-o1', { action: 'list' });
    assert.equal(r.body.email_lookup, 'ok'); assert.equal(r.body.accounts.find(a => a.id === S2).sign_in_blocked, null);
    assert.equal(r.body.accounts.find(a => a.id === S1).sign_in_blocked, false);
  });
  await test('profiles list failure -> 500 with a message', async () => {
    state.flags.profileListFails = true;
    const r = await manage('tok-o1', { action: 'list' }); assert.equal(r.status, 500); assert.ok(r.body.error);
  });

  // ── Disable ───────────────────────────────────────────────────────────────
  await test('Disable: DB/RLS access removed BEFORE the Auth ban, sessions revoked, then a sweep; only the target changes', async () => {
    const r = await manage('tok-o1', { action: 'disable', user_id: S1 });
    assert.equal(r.status, 200); assert.equal(r.body.disabled, true); assert.equal(r.body.sign_in_blocked, true); assert.equal(r.body.sessions_revoked, 2);
    assert.deepEqual(sequence(r.calls), ['rpc:disable', 'ban:876000h', 'rpc:disable']);
    assert.equal(state.profiles[S1].is_active, false); assert.equal(state.profiles[S1].disabled_by, O1);
    assert.ok(Date.parse(state.users[S1].banned_until) > Date.now());
    assert.equal(state.sessions[S1], 0);
    assert.equal(state.profiles[S2].is_active, true); assert.equal(state.sessions[S2], 1); assert.equal(state.sessions[O1], 1);
    assert.ok(state.users[S1], 'the login and its history are kept, never deleted');
    assert.ok(r.calls.filter(c => isMutation(c)).every(c => c.who === 'service'));
  });
  await test('Disable identifies the acting Owner from the verified JWT, not from the request body', async () => {
    const r = await manage('tok-o1', { action: 'disable', user_id: S1, actor: O2, p_actor: O2, user: { id: O2 } });
    assert.equal(r.status, 200);
    assert.ok(r.calls.filter(c => c.p === '/rest/v1/rpc/set_staff_account_active').every(c => c.body.p_actor === O1));
    assert.equal(state.profiles[S1].disabled_by, O1);
  });
  await test('Disable is idempotent and works as a retry', async () => {
    let r = await manage('tok-o1', { action: 'disable', user_id: S1 }); assert.equal(r.status, 200);
    r = await manage('tok-o1', { action: 'disable', user_id: S1 }); assert.equal(r.status, 200); assert.equal(r.body.sessions_revoked, 0);
    r = await manage('tok-o1', { action: 'disable', user_id: S3 }); assert.equal(r.status, 200, 'already-disabled account');
  });
  await test('Disable when the Auth ban fails: 502, app access stays disabled, sessions stay revoked, clear retry message, retry succeeds', async () => {
    state.flags.banFails = true;
    let r = await manage('tok-o1', { action: 'disable', user_id: S1 });
    assert.equal(r.status, 502); assert.equal(r.body.partial, true); assert.equal(r.body.app_access_disabled, true); assert.equal(r.body.sign_in_blocked, false);
    assert.match(r.body.error, /Disable Account again/);
    assert.equal(state.profiles[S1].is_active, false); assert.equal(state.sessions[S1], 0);
    state.flags.banFails = false;
    r = await manage('tok-o1', { action: 'disable', user_id: S1 }); assert.equal(r.status, 200); assert.ok(state.users[S1].banned_until);
  });
  await test('Disable when the database step fails: no ban is attempted and the error is reported', async () => {
    state.flags.rpcAlwaysFails = true;
    const r = await manage('tok-o1', { action: 'disable', user_id: S1 });
    assert.equal(r.status, 500); assert.equal(sequence(r.calls).some(s => s.startsWith('ban:')), false);
    assert.equal(state.profiles[S1].is_active, true);
  });
  await test('Disable: a failed sweep does not fail the request (ban already applied)', async () => {
    state.flags.rpcFailsAtCall = 2;
    const r = await manage('tok-o1', { action: 'disable', user_id: S1 });
    assert.equal(r.status, 200); assert.equal(r.body.sessions_revoked, 2); assert.equal(r.body.session_sweep, 'failed');
  });

  // ── Owner protection ──────────────────────────────────────────────────────
  await test('Owner accounts cannot be disabled, enabled, edited (even name-only) or deleted through the function', async () => {
    for (const action of ['disable', 'enable', 'update', 'delete']) {
      reset();
      const r = await manage('tok-o1', { action, user_id: O2, full_name: 'Hacked', email: 'h@x.zz', password: 'password123' });
      assert.ok([403, 400].includes(r.status), `${action} -> ${r.status}`);
      assert.equal(mutations(r.calls).length, 0, action);
      assert.equal(state.profiles[O2].is_active, true); assert.equal(state.profiles[O2].full_name, 'QA Owner Two'); assert.equal(state.users[O2].email, 'owner2@test.local');
    }
  });
  await test('the current Owner cannot disable or edit themselves', async () => {
    for (const action of ['disable', 'enable', 'update']) {
      reset();
      const r = await manage('tok-o1', { action, user_id: O1, full_name: 'Self', password: 'password123' });
      assert.equal(r.status, 403, action); assert.equal(mutations(r.calls).length, 0, action);
    }
    assert.equal(state.profiles[O1].is_active, true);
  });
  await test('unknown, malformed and missing user_id are rejected without touching anything', async () => {
    let r = await manage('tok-o1', { action: 'disable', user_id: GHOST }); assert.equal(r.status, 404); assert.equal(mutations(r.calls).length, 0);
    r = await manage('tok-o1', { action: 'disable', user_id: "x' or role.eq.owner" }); assert.equal(r.status, 404); assert.equal(mutations(r.calls).length, 0);
    assert.ok(!r.calls.some(c => c.p === '/rest/v1/profiles' && c.q.includes("or role")), 'malformed id never reaches the query');
    r = await manage('tok-o1', { action: 'disable' }); assert.equal(r.status, 400);
    r = await manage('tok-o1', { action: 'enable', user_id: '' }); assert.equal(r.status, 400);
  });

  // ── Enable ────────────────────────────────────────────────────────────────
  await test('Enable: Auth login unblocked first, then app access restored', async () => {
    await manage('tok-o1', { action: 'disable', user_id: S1 });
    const r = await manage('tok-o1', { action: 'enable', user_id: S1 });
    assert.equal(r.status, 200); assert.equal(r.body.enabled, true);
    assert.deepEqual(sequence(r.calls), ['ban:none', 'rpc:enable']);
    assert.equal(state.profiles[S1].is_active, true); assert.equal(state.profiles[S1].disabled_at, null); assert.equal(state.users[S1].banned_until, null);
    assert.equal(state.sessions[S1], 0, 'revoked sessions are not resurrected');
  });
  await test('Enable when unban fails: 502 and the account STAYS disabled in the app (fail closed)', async () => {
    state.flags.unbanFails = true;
    const r = await manage('tok-o1', { action: 'enable', user_id: S3 });
    assert.equal(r.status, 502); assert.match(r.body.error, /still disabled/);
    assert.equal(state.profiles[S3].is_active, false); assert.equal(sequence(r.calls).includes('rpc:enable'), false);
  });
  await test('Enable when the database step fails after unban: reported, account still disabled in the app', async () => {
    state.flags.rpcAlwaysFails = true;
    const r = await manage('tok-o1', { action: 'enable', user_id: S3 });
    assert.equal(r.status, 500); assert.match(r.body.error, /still disabled in the app/);
    assert.equal(state.profiles[S3].is_active, false);
  });

  // ── Hard delete is gone ───────────────────────────────────────────────────
  await test('the delete action no longer exists: 400, nothing deleted, guidance to disable', async () => {
    const r = await manage('tok-o1', { action: 'delete', user_id: S1 });
    assert.equal(r.status, 400); assert.match(r.body.error, /Disable Account/);
    assert.ok(!r.calls.some(c => c.m === 'DELETE')); assert.ok(state.users[S1]); assert.ok(state.profiles[S1]);
    assert.equal(mutations(r.calls).length, 0);
    const source = await readFile(new URL('../../supabase/functions/manage-staff-user/index.ts', import.meta.url), 'utf8');
    assert.equal(/deleteUser/.test(source), false, 'no deleteUser call remains in the function');
  });

  // ── Update (all edits, including name-only, go through the function) ──────
  await test('name-only edit for Staff: profile renamed with the Owner JWT, Auth email/password untouched, metadata preserved', async () => {
    const r = await manage('tok-o1', { action: 'update', user_id: S1, full_name: '  New Name  ', email: '', password: '' });
    assert.equal(r.status, 200);
    assert.equal(state.profiles[S1].full_name, 'New Name'); assert.equal(state.users[S1].email, 's1@test.local'); assert.ok(!state.users[S1].password);
    assert.equal(state.users[S1].user_metadata.keep, 'me'); assert.equal(state.users[S1].user_metadata.full_name, 'New Name');
    const patches = r.calls.filter(c => c.m === 'PATCH'); assert.equal(patches.length, 1); assert.equal(patches[0].who, 'user:' + O1);
  });
  await test('a password reset also signs the Staff user out everywhere; name-only and email-only edits do not', async () => {
    let r = await manage('tok-o1', { action: 'update', user_id: S1, full_name: 'Pw', password: 'brandnewpass1' });
    assert.equal(r.status, 200); assert.equal(r.body.sessions_revoked, 2); assert.equal(r.body.session_revoke_failed, false);
    assert.equal(state.sessions[S1], 0); assert.equal(state.sessions[S2], 1); assert.equal(state.sessions[O1], 1);
    assert.ok(r.calls.filter(c => c.p === '/rest/v1/rpc/revoke_staff_sessions').every(c => c.who === 'service' && c.body.p_actor === O1 && c.body.p_target === S1));
    reset(); r = await manage('tok-o1', { action: 'update', user_id: S1, full_name: 'NameOnly' });
    assert.equal(state.revokeCalls, 0); assert.equal(state.sessions[S1], 2); assert.equal('sessions_revoked' in r.body, false);
    reset(); await manage('tok-o1', { action: 'update', user_id: S1, full_name: 'EmailOnly', email: 'e@t.l' });
    assert.equal(state.revokeCalls, 0);
  });
  await test('password reset succeeds but reports when the session revoke failed', async () => {
    state.flags.revokeFails = true;
    const r = await manage('tok-o1', { action: 'update', user_id: S1, full_name: 'Pw', password: 'brandnewpass1' });
    assert.equal(r.status, 200); assert.equal(r.body.session_revoke_failed, true); assert.equal(state.users[S1].password, 'brandnewpass1');
  });
  await test('password validation failure never reaches Auth or the session revoke', async () => {
    const r = await manage('tok-o1', { action: 'update', user_id: S1, full_name: 'Pw', password: 'short' });
    assert.equal(r.status, 400); assert.equal(state.revokeCalls, 0); assert.equal(mutations(r.calls).length, 0);
  });
  await test('name-only edit for an Owner target is refused server-side (target-role check always runs)', async () => {
    const r = await manage('tok-o1', { action: 'update', user_id: O2, full_name: 'Renamed Owner' });
    assert.equal(r.status, 403); assert.equal(state.profiles[O2].full_name, 'QA Owner Two'); assert.equal(mutations(r.calls).length, 0);
  });
  await test('Owner may still edit a DISABLED Staff account (e.g. fix the name) and it stays disabled', async () => {
    const r = await manage('tok-o1', { action: 'update', user_id: S3, full_name: 'Renamed While Disabled' });
    assert.equal(r.status, 200); assert.equal(state.profiles[S3].full_name, 'Renamed While Disabled'); assert.equal(state.profiles[S3].is_active, false);
  });
  await test('email + password change: lower-cased email, password never echoed', async () => {
    const r = await manage('tok-o1', { action: 'update', user_id: S1, full_name: 'S One', email: 'NEW@Test.Local', password: 'longenough1' });
    assert.equal(r.status, 200); assert.equal(state.users[S1].email, 'new@test.local'); assert.equal(state.users[S1].password, 'longenough1');
    assert.ok(!JSON.stringify(r.body).includes('longenough1'));
  });
  await test('server-side password length: 7 rejected; 8 and 72 bytes accepted; 73 bytes, multibyte overflow and 5000 chars rejected', async () => {
    const cases = [['x'.repeat(7), 400], ['x'.repeat(8), 200], ['x'.repeat(72), 200], ['x'.repeat(73), 400], ['€'.repeat(25), 400], ['€'.repeat(24), 200], ['x'.repeat(5000), 400]];
    for (const [password, expected] of cases) {
      reset();
      const r = await manage('tok-o1', { action: 'update', user_id: S1, full_name: 'ok', password });
      assert.equal(r.status, expected, `len=${password.length} bytes=${Buffer.byteLength(password)}`);
      if (expected === 400) { assert.equal(mutations(r.calls).length, 0); assert.ok(!state.users[S1].password); assert.match(r.body.error, /Password must be/); }
    }
  });
  await test('name/email validation and malformed body', async () => {
    for (const body of [{ full_name: '' }, { full_name: 'x'.repeat(121) }, { full_name: 'ok', email: 'not-an-email' }]) {
      reset(); const r = await manage('tok-o1', { action: 'update', user_id: S1, ...body }); assert.equal(r.status, 400); assert.equal(mutations(r.calls).length, 0);
    }
    reset(); const r = await manage('tok-o1', null, { raw: '{bad json' }); assert.equal(r.status, 400);
  });
  await test('Auth rejects duplicate email: 400 and the profile is not renamed', async () => {
    state.flags.authUpdateFails = true;
    const r = await manage('tok-o1', { action: 'update', user_id: S1, full_name: 'Dup', email: 's2@test.local' });
    assert.equal(r.status, 400); assert.equal(state.profiles[S1].full_name, 'QA Staff One');
  });
  await test('profile update failure after an email change rolls the email back; after a password change it warns instead', async () => {
    state.flags.profilePatchFails = true;
    let r = await manage('tok-o1', { action: 'update', user_id: S1, full_name: 'Rollback', email: 'changed@test.local' });
    assert.equal(r.status, 500); assert.equal(state.users[S1].email, 's1@test.local'); assert.equal(state.users[S1].user_metadata.full_name, 'QA Staff One');
    reset(); state.flags.profilePatchFails = true;
    r = await manage('tok-o1', { action: 'update', user_id: S1, full_name: 'Rollback2', password: 'newpassword1' });
    assert.equal(r.status, 500); assert.match(r.body.error, /may have succeeded/);
    reset(); state.flags.profilePatchFails = true;
    r = await manage('tok-o1', { action: 'update', user_id: S1, full_name: 'NameOnlyFail' });
    assert.equal(r.status, 500);
    assert.ok(r.calls.filter(c => c.m === 'PUT').every(c => !c.body.email), 'name-only rollback never re-sends an email');
  });

  // ── CORS / configuration ──────────────────────────────────────────────────
  await test('CORS preflight allowed; foreign Origin never reflected; missing service key -> 500 without leaking it', async () => {
    let r = await manage(null, null, { method: 'OPTIONS' });
    assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), 'https://aquaspin-laundry-station.vercel.app');
    r = await manage('tok-o1', { action: 'list' }, { headers: { Origin: 'https://evil.example' } });
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://aquaspin-laundry-station.vercel.app');
    const saved = env.SUPABASE_SERVICE_ROLE_KEY; env.SUPABASE_SERVICE_ROLE_KEY = '';
    try { r = await manage('tok-o1', { action: 'list' }); assert.equal(r.status, 500); assert.ok(!JSON.stringify(r.body).includes(SERVICE)); }
    finally { env.SUPABASE_SERVICE_ROLE_KEY = saved; }
  });

  // ── create-staff-user ─────────────────────────────────────────────────────
  await test('create-staff-user: Staff, demoted and DISABLED callers refused; no Auth user is created', async () => {
    let r = await create('tok-s1', { full_name: 'X', email: 'x@y.zz', password: 'password1' }); assert.equal(r.status, 403);
    reset(); state.profiles[O1].is_active = false; r = await create('tok-o1', { full_name: 'X', email: 'x@y.zz', password: 'password1' }); assert.equal(r.status, 403);
    reset(); r = await create('tok-s3', { full_name: 'X', email: 'x@y.zz', password: 'password1' }); assert.equal(r.status, 403);
    assert.equal(mutations(r.calls).length, 0);
  });
  await test('create-staff-user password length is enforced server-side (min 8, max 72 bytes) before any Auth call', async () => {
    for (const [password, expected] of [['x'.repeat(7), 400], ['x'.repeat(8), 200], ['x'.repeat(72), 200], ['x'.repeat(73), 400], ['€'.repeat(25), 400]]) {
      reset(); state.upserts = [];
      const r = await create('tok-o1', { full_name: 'New Staff', email: 'new@test.local', password });
      assert.equal(r.status, expected, `bytes=${Buffer.byteLength(password)}`);
      if (expected === 400) assert.ok(!r.calls.some(c => c.p === '/auth/v1/admin/users' && c.m === 'POST'));
      else { assert.equal(r.body.user.role, 'staff'); assert.ok(state.upserts.length === 1); assert.equal(state.upserts[0].role, 'staff'); }
    }
  });
  await test('create-staff-user malformed JSON -> 400 (no crash)', async () => {
    const r = await create('tok-o1', null, { raw: '{bad' }); assert.equal(r.status, 400);
  });

  console.log(`\n${passed} PASS; 0 FAIL (Edge Function behaviour against a local mock of Supabase Auth/PostgREST; no network).`);
} finally {
  server.close();
  await rm(tmpDir, { recursive: true, force: true });
}
