import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createPublicTrackingToken,
  createTrackingRateLimitKey,
  verifyPublicTrackingToken,
  toPublicTrackingStatus,
  canIssuePublicTrackingLink,
  lookupPublicTrackingStatus,
} from '../src/lib/public-tracking.ts'

const transactionId = '0ad2c1a7-6e43-4d81-83fb-57d577c42481'
const secret = '0123456789abcdef'.repeat(4)

test('signed tracking token is verifiable and bound to its transaction', async () => {
  const token = await createPublicTrackingToken(transactionId, secret)
  assert.ok(token)
  assert.match(token, /^v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/)
  assert.equal(await verifyPublicTrackingToken(token, secret), transactionId)
  assert.equal(await verifyPublicTrackingToken(token, 'fedcba9876543210'.repeat(4)), null)
})

test('key rotation can verify old links temporarily while issuing with the current key', async () => {
  const previousSecret = 'abcdef0123456789'.repeat(4)
  const oldToken = await createPublicTrackingToken(transactionId, previousSecret)
  assert.equal(await verifyPublicTrackingToken(oldToken, secret), null)
  assert.equal(await verifyPublicTrackingToken(oldToken, [secret, previousSecret]), transactionId)

  const currentToken = await createPublicTrackingToken(transactionId, secret)
  assert.equal(await verifyPublicTrackingToken(currentToken, [secret, previousSecret]), transactionId)
  assert.equal(await verifyPublicTrackingToken(oldToken, [secret]), null)
})

test('malformed and tampered tracking tokens fail closed', async () => {
  assert.equal(await createPublicTrackingToken('not-a-uuid', secret), null)
  assert.equal(await createPublicTrackingToken(transactionId, 'short'), null)
  assert.equal(await verifyPublicTrackingToken('', secret), null)
  assert.equal(await verifyPublicTrackingToken('AQ-7C08D84E', secret), null)
  assert.equal(await verifyPublicTrackingToken('v1.' + transactionId + '.not-a-signature', secret), null)

  const token = await createPublicTrackingToken(transactionId, secret)
  const tampered = token.replace(transactionId, '0bd2c1a7-6e43-4d81-83fb-57d577c42481')
  assert.equal(await verifyPublicTrackingToken(tampered, secret), null)
})

test('tracking rate-limit keys are stable, transaction-scoped, and do not contain the transaction ID', async () => {
  const otherTransactionId = '1ad2c1a7-6e43-4d81-83fb-57d577c42481'
  const first = await createTrackingRateLimitKey(transactionId, secret)
  assert.ok(first)
  assert.equal(await createTrackingRateLimitKey(transactionId, secret), first)
  assert.notEqual(await createTrackingRateLimitKey(otherTransactionId, secret), first)
  assert.ok(!first.includes(transactionId))
  assert.equal(await createTrackingRateLimitKey('not-a-uuid', secret), null)
})

test('tracking response only includes the public order code and current status', () => {
  const status = toPublicTrackingStatus({
    transaction_code: 'AQ-7C08D84E',
    order_status: 'washing',
    total_amount: 415,
    payment_method: 'gcash',
    kg: 8,
    no_of_loads: 2,
    customer_name: 'Private Customer',
    created_at: '2026-09-28T00:00:00Z',
  })

  assert.deepEqual(status, { transaction_code: 'AQ-7C08D84E', order_status: 'washing' })
  assert.deepEqual(Object.keys(status), ['transaction_code', 'order_status'])
  assert.equal(toPublicTrackingStatus(null), null)
  assert.equal(toPublicTrackingStatus({ transaction_code: 1, order_status: 'washing' }), null)
  assert.equal(toPublicTrackingStatus({ transaction_code: 'AQ-TEST', order_status: 'cancelled' }), null)
  assert.equal(toPublicTrackingStatus({ transaction_code: 'AQ-TEST', order_status: 'unexpected' }), null)
})

test('only active Owner and Staff profiles may issue tracking links', () => {
  assert.equal(canIssuePublicTrackingLink({ role: 'owner', is_active: true }), true)
  assert.equal(canIssuePublicTrackingLink({ role: 'staff', is_active: true }), true)
  assert.equal(canIssuePublicTrackingLink({ role: 'staff', is_active: false }), false)
  assert.equal(canIssuePublicTrackingLink({ role: 'anonymous', is_active: true }), false)
  assert.equal(canIssuePublicTrackingLink(null), false)
})

test('lookup verifies the capability before reading data and fails closed for hidden orders', async () => {
  let readCount = 0
  const readOrder = async () => {
    readCount++
    return {
      transaction_code: 'AQ-7C08D84E',
      order_status: 'washing',
      total_amount: 415,
      payment_method: 'gcash',
      customer_name: 'Private Customer',
      deleted_at: null,
    }
  }

  assert.deepEqual(await lookupPublicTrackingStatus('AQ-7C08D84E', secret, readOrder), { found: false })
  assert.equal(readCount, 0, 'malformed claim code must not trigger a transaction lookup')

  const token = await createPublicTrackingToken(transactionId, secret)
  assert.deepEqual(await lookupPublicTrackingStatus(token, secret, readOrder), {
    found: true,
    transaction_code: 'AQ-7C08D84E',
    order_status: 'washing',
  })
  assert.equal(readCount, 1)

  const hidden = async (row) => lookupPublicTrackingStatus(token, secret, async () => row)
  assert.deepEqual(await hidden(null), { found: false })
  assert.deepEqual(await hidden({ transaction_code: 'AQ-TEST', order_status: 'cancelled', deleted_at: null }), { found: false })
  assert.deepEqual(await hidden({ transaction_code: 'AQ-TEST', order_status: 'washing', deleted_at: '2026-09-28T00:00:00Z' }), { found: false })
})

test('lookup rate limits only verified tokens before reading order data', async () => {
  const token = await createPublicTrackingToken(transactionId, secret)
  const calls = []
  const readOrder = async (id) => {
    calls.push(['read', id])
    return { transaction_code: 'AQ-7C08D84E', order_status: 'washing', deleted_at: null }
  }
  const checkRateLimit = async (id) => {
    calls.push(['limit', id])
    return true
  }

  assert.deepEqual(await lookupPublicTrackingStatus('forged-token', secret, readOrder, checkRateLimit), { found: false })
  assert.deepEqual(calls, [], 'invalid token must not invoke rate limiting or read order data')

  assert.deepEqual(await lookupPublicTrackingStatus(token, secret, readOrder, checkRateLimit), {
    found: true,
    transaction_code: 'AQ-7C08D84E',
    order_status: 'washing',
  })
  assert.deepEqual(calls, [['limit', transactionId], ['read', transactionId]])

  calls.length = 0
  const rejectRateLimit = async (id) => {
    calls.push(['limit', id])
    return false
  }
  assert.deepEqual(await lookupPublicTrackingStatus(token, secret, readOrder, rejectRateLimit), {
    found: false,
    rate_limited: true,
  })
  assert.deepEqual(calls, [['limit', transactionId]], 'rate-limited token must not read order data')
})
