import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateSalesMetrics } from '../src/lib/sales-metrics.ts'

const shopDate = '2026-09-18'
const monthStart = '2026-09-01'
const row = (overrides = {}) => ({
  transaction_date: shopDate,
  payment_method: 'paid',
  total_amount: 100,
  cash_amount: 100,
  gcash_amount: 0,
  order_status: 'completed',
  deleted_at: null,
  kg: 2,
  ...overrides,
})

test('paid transaction is included in Monthly Sales', () => {
  assert.equal(calculateSalesMetrics([row({ payment_method: 'paid' })], shopDate, monthStart).monthlySales, 100)
})

test('GCash transaction is included in Monthly Sales', () => {
  assert.equal(calculateSalesMetrics([row({ payment_method: 'gcash', cash_amount: 0, gcash_amount: 100 })], shopDate, monthStart).monthlySales, 100)
})

test('Pay Later transaction is included in Monthly Sales', () => {
  assert.equal(calculateSalesMetrics([row({ payment_method: 'pay_later', cash_amount: 0, gcash_amount: 0 })], shopDate, monthStart).monthlySales, 100)
})

test('paid transaction is included in Cash Collected', () => {
  assert.equal(calculateSalesMetrics([row({ payment_method: 'paid' })], shopDate, monthStart).cashCollected, 100)
})

test('GCash transaction is included in Cash Collected', () => {
  assert.equal(calculateSalesMetrics([row({ payment_method: 'gcash', cash_amount: 0, gcash_amount: 100 })], shopDate, monthStart).cashCollected, 100)
})

test('Pay Later is excluded from Cash Collected', () => {
  assert.equal(calculateSalesMetrics([row({ payment_method: 'pay_later', cash_amount: 0, gcash_amount: 0 })], shopDate, monthStart).cashCollected, 0)
})

test('previous-month Pay Later appears in Outstanding Pay Later', () => {
  const metrics = calculateSalesMetrics([row({ transaction_date: '2026-08-31', payment_method: 'pay_later', cash_amount: 0, gcash_amount: 0 })], shopDate, monthStart)
  assert.equal(metrics.outstandingPayLater, 100)
})

test('cancelled transactions are excluded from all metrics', () => {
  const metrics = calculateSalesMetrics([row({ order_status: 'cancelled' })], shopDate, monthStart)
  assert.deepEqual(metrics, { monthlySales: 0, cashCollected: 0, outstandingPayLater: 0, todaySales: 0, todayOrders: 0, todayWeight: 0 })
})

test('soft-deleted transactions are excluded from all metrics', () => {
  const metrics = calculateSalesMetrics([row({ deleted_at: '2026-09-18T04:00:00.000Z' })], shopDate, monthStart)
  assert.deepEqual(metrics, { monthlySales: 0, cashCollected: 0, outstandingPayLater: 0, todaySales: 0, todayOrders: 0, todayWeight: 0 })
})

test('future-dated transactions are excluded from all metrics', () => {
  const metrics = calculateSalesMetrics([row({ transaction_date: '2026-09-19' })], shopDate, monthStart)
  assert.deepEqual(metrics, { monthlySales: 0, cashCollected: 0, outstandingPayLater: 0, todaySales: 0, todayOrders: 0, todayWeight: 0 })
})

test('duplicate transaction IDs are counted once', () => {
  const duplicate = row({ id: 'transaction-1' })
  assert.equal(calculateSalesMetrics([duplicate, { ...duplicate }], shopDate, monthStart).monthlySales, 100)
})

test('Owner/Staff visibility remains input-scoped by existing RLS/settings', () => {
  const ownerRows = [row({ transaction_date: '2026-08-31', payment_method: 'pay_later', cash_amount: 0, gcash_amount: 0 })]
  const staffRows = []
  assert.equal(calculateSalesMetrics(ownerRows, shopDate, monthStart).outstandingPayLater, 100)
  assert.equal(calculateSalesMetrics(staffRows, shopDate, monthStart).outstandingPayLater, 0)
})
