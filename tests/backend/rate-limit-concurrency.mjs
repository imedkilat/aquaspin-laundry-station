import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)
const limit = 8
const simultaneousRequests = 40
const gateLock = '2147483647, 2147483647'
const clientAppName = 'pr36-rate-limit-client'

function startPsql(args = [], appName = 'pr36-rate-limit-test') {
  const child = spawn('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', ...args], {
    env: { ...process.env, PGAPPNAME: appName },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  const waiters = new Set()

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
    for (const waiter of waiters) {
      if (stdout.includes(waiter.marker)) {
        waiters.delete(waiter)
        clearTimeout(waiter.timeout)
        waiter.resolve()
      }
    }
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })

  const closed = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`psql exited ${code}: ${stderr}`))
    })
  })

  return {
    child,
    closed,
    write: (sql) => child.stdin.write(`${sql}\n`),
    waitFor: (marker, timeoutMs = 15_000) => {
      if (stdout.includes(marker)) return Promise.resolve()
      return new Promise((resolve, reject) => {
        const waiter = {
          marker,
          resolve,
          timeout: setTimeout(() => {
            waiters.delete(waiter)
            reject(new Error(`Timed out waiting for psql marker ${marker}; output: ${stdout}; error: ${stderr}`))
          }, timeoutMs),
        }
        waiters.add(waiter)
      })
    },
  }
}

async function query(sql, appName = 'pr36-rate-limit-monitor') {
  const { stdout } = await execFileAsync('psql', [
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql,
  ], { env: { ...process.env, PGAPPNAME: appName } })
  return stdout.trim()
}

async function assertDenied(role) {
  await assert.rejects(
    execFileAsync('psql', [
      '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c',
      `set role ${role}; select public.check_rate_limit('role-boundary-${role}', 1, 60)`,
    ]),
    (error) => error.stderr.includes('permission denied for function check_rate_limit'),
    `${role} must not be allowed to call check_rate_limit`,
  )
}

await assertDenied('anon')
await assertDenied('authenticated')
assert.equal(
  await query("set role service_role; select public.check_rate_limit('role-boundary-service', 1, 60)"),
  't',
  'service_role should be allowed to call check_rate_limit',
)

await query(`
  create or replace function public.pr36_test_rate_limit_insert_gate()
  returns trigger
  language plpgsql
  set search_path = ''
  as $$
  begin
    perform pg_catalog.pg_advisory_xact_lock(${gateLock});
    return new;
  end;
  $$;
  drop trigger if exists pr36_test_rate_limit_insert_gate on public.rate_limit_hits;
  create trigger pr36_test_rate_limit_insert_gate
    before insert on public.rate_limit_hits
    for each row execute function public.pr36_test_rate_limit_insert_gate();
`)

const key = `rate-limit-concurrency-${randomUUID()}`
const gate = startPsql()
let clients = []
let gateReleased = false

try {
  const lockedMarker = gate.waitFor('PR36_GATE_LOCKED')
  gate.write(`begin; select pg_catalog.pg_advisory_lock(${gateLock}); select 'PR36_GATE_LOCKED';`)
  await lockedMarker

  clients = Array.from({ length: simultaneousRequests }, () => {
    const client = startPsql(['-c', `select public.check_rate_limit('${key}', ${limit}, 60)`], clientAppName)
    return { ...client, result: client.closed.then(({ stdout }) => stdout.trim()) }
  })

  const deadline = Date.now() + 15_000
  let active = 0
  while (Date.now() < deadline) {
    active = Number(await query(`
      select pg_catalog.count(*)
        from pg_catalog.pg_stat_activity
       where application_name = '${clientAppName}'
         and state = 'active'
         and query like 'select public.check_rate_limit(%'
    `))
    if (active === simultaneousRequests) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  assert.equal(active, simultaneousRequests, 'all independent sessions must reach the held test barrier')

  const releaseMarker = gate.waitFor('PR36_GATE_RELEASED')
  gate.write(`select pg_catalog.pg_advisory_unlock(${gateLock}); select 'PR36_GATE_RELEASED';`)
  await releaseMarker
  gateReleased = true

  const results = await Promise.all(clients.map((client) => client.result))
  const admitted = results.filter((result) => result === 't').length
  assert.equal(admitted, limit, `the synchronized race should admit exactly ${limit} of ${simultaneousRequests} requests`)

  const stored = await query(`select count(*) from public.rate_limit_hits where rate_key = '${key}'`)
  assert.equal(Number(stored), limit, 'the database should store exactly the admitted requests')
} finally {
  if (!gateReleased) {
    if (gate.child.exitCode === null) gate.child.kill()
  }
  for (const client of clients) {
    if (client.child.exitCode === null) client.child.kill()
  }
  if (gateReleased && gate.child.exitCode === null) {
    gate.write('rollback;')
    gate.write('\\q')
  }
  await Promise.allSettled([gate.closed, ...clients.map((client) => client.closed)])
  await query('drop trigger if exists pr36_test_rate_limit_insert_gate on public.rate_limit_hits; drop function if exists public.pr36_test_rate_limit_insert_gate()')
}

console.log(`PostgreSQL rate-limit regression passed: ${simultaneousRequests} synchronized sessions; cap ${limit}; anon/authenticated denied; service_role allowed.`)
