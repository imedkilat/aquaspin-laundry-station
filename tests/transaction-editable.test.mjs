import assert from 'node:assert/strict'
import test from 'node:test'
import { canEditTransaction } from '../src/lib/transaction-edit.ts'

test('active orders can be edited when not deleted', () => {
  for (const status of ['received', 'washing', 'drying', 'ready_for_pickup', 'on_hold']) {
    assert.equal(canEditTransaction(status, false), true, status)
  }
})

test('completed and cancelled orders cannot be edited from transaction lists', () => {
  assert.equal(canEditTransaction('completed', false), false)
  assert.equal(canEditTransaction('cancelled', false), false)
})

test('only Owners can edit completed orders; deleted and cancelled orders stay locked', () => {
  assert.equal(canEditTransaction('completed', false, true), true)
  assert.equal(canEditTransaction('completed', false, false), false)
  assert.equal(canEditTransaction('completed', true, true), false)
  assert.equal(canEditTransaction('cancelled', false, true), false)
})

test('deleted orders cannot be edited regardless of their status', () => {
  assert.equal(canEditTransaction('received', true), false)
  assert.equal(canEditTransaction('cancelled', true), false)
})
