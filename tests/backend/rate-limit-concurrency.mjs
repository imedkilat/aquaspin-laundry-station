import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)
const limit = 8
const simultaneousRequests = 40
const rounds = 3

async function query(sql) {
  const { stdout } = await execFileAsync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql])
  return stdout.trim()
}

for (let round = 0; round < rounds; round += 1) {
  const key = `rate-limit-concurrency-${randomUUID()}`
  const results = await Promise.all(
    Array.from({ length: simultaneousRequests }, () =>
      query(`select public.check_rate_limit('${key}', ${limit}, 60)`),
    ),
  )

  const admitted = results.filter((result) => result === 't').length
  assert.equal(admitted, limit, `round ${round + 1} should admit exactly ${limit} of ${simultaneousRequests} parallel requests`)

  const stored = await query(`select count(*) from public.rate_limit_hits where rate_key = '${key}'`)
  assert.equal(Number(stored), limit, `round ${round + 1} should store exactly the admitted requests`)
}

console.log(`PostgreSQL concurrency regression passed: ${rounds} rounds × ${simultaneousRequests} sessions; cap ${limit}.`)
