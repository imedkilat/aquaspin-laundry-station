import assert from 'node:assert/strict'
import test from 'node:test'
import { getCustomerDirectoryRows, paginateCustomerRows } from '../src/lib/customer-directory.ts'

function customer(id, overrides = {}) {
  return {
    id,
    full_name: id,
    customer_code: `CUS-${id}`,
    phone_number: null,
    active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    first_visit: null,
    total_transactions: 0,
    last_visit: null,
    outstanding_balance: 0,
    points_balance: 0,
    has_redeemed_reward: false,
    ...overrides,
  }
}

test('customer directory sorts by first visit/registration date and puts frequent visitors first', () => {
  const rows = [
    customer('Later visit', { first_visit: '2026-03-01', created_at: '2026-01-01', total_transactions: 4 }),
    customer('Registered recently', { created_at: '2026-02-15', total_transactions: 12 }),
    customer('Earlier visit', { first_visit: '2026-01-15', created_at: '2026-03-20', total_transactions: 8 }),
  ]

  assert.deepEqual(getCustomerDirectoryRows(rows, { sort: 'newest' }).map((row) => row.id), [
    'Later visit', 'Registered recently', 'Earlier visit',
  ])
  assert.deepEqual(getCustomerDirectoryRows(rows, { sort: 'most_visits' }).map((row) => row.id), [
    'Registered recently', 'Earlier visit', 'Later visit',
  ])
})

test('already-redeemed view and activity status combine with the existing search fields', () => {
  const rows = [
    customer('Ari', { phone_number: '09170000001', has_redeemed_reward: true }),
    customer('Bea', { customer_code: 'CUS-REDEEMED', has_redeemed_reward: true, active: false }),
    customer('Cia', { has_redeemed_reward: false }),
  ]

  assert.deepEqual(getCustomerDirectoryRows(rows, { sort: 'redeemed', activity: 'all' }).map((row) => row.id), ['Ari', 'Bea'])
  assert.deepEqual(getCustomerDirectoryRows(rows, { sort: 'redeemed', activity: 'active', search: '0917' }).map((row) => row.id), ['Ari'])
  assert.deepEqual(getCustomerDirectoryRows(rows, { sort: 'redeemed', activity: 'all', search: 'CUS-REDEEMED' }).map((row) => row.id), ['Bea'])
})

test('directory search remains case-insensitive across name, phone, and CUS-ID', () => {
  const rows = [customer('Ari Santos', { phone_number: '09171234567', customer_code: 'CUS-00042' })]

  assert.equal(getCustomerDirectoryRows(rows, { activity: 'all', search: 'ari san' }).length, 1)
  assert.equal(getCustomerDirectoryRows(rows, { activity: 'all', search: '091712' }).length, 1)
  assert.equal(getCustomerDirectoryRows(rows, { activity: 'all', search: 'cus-00042' }).length, 1)
})

test('pagination shows exactly 20 rows on page one and the remainder on page two', () => {
  const rows = Array.from({ length: 47 }, (_, index) => index)
  const first = paginateCustomerRows(rows, 1)
  const second = paginateCustomerRows(rows, 2)
  const third = paginateCustomerRows(rows, 3)

  assert.deepEqual([first.rows.length, first.page, first.pageCount, first.total], [20, 1, 3, 47])
  assert.deepEqual([second.rows.length, second.rows[0], second.rows.at(-1), second.page], [20, 20, 39, 2])
  assert.deepEqual([third.rows.length, third.rows[0], third.page], [7, 40, 3])
})

test('pagination handles exact page boundaries and clamps invalid page requests', () => {
  const rows = Array.from({ length: 20 }, (_, index) => index)
  const exact = paginateCustomerRows(rows, 2)
  const empty = paginateCustomerRows([], 0)
  const clamped = paginateCustomerRows(Array.from({ length: 21 }, (_, index) => index), 99)

  assert.deepEqual([exact.rows.length, exact.page, exact.pageCount], [20, 1, 1])
  assert.deepEqual([empty.rows.length, empty.page, empty.pageCount], [0, 1, 1])
  assert.deepEqual([clamped.rows.length, clamped.page, clamped.pageCount], [1, 2, 2])
})
