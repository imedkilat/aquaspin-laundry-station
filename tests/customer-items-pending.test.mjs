import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hasPositiveCustomerItems, isCustomerItemsPending, canEditCustomerItems, customerItemsHref } from '../src/lib/customer-items-pending.ts';

const activeRow = (order_status, overrides = {}) => ({
  id: `${order_status}-id`,
  order_status,
  deleted_at: null,
  hasCustomerItems: false,
  ...overrides,
});

test('Received, Washing, and Ready for Pickup orders without items are pending', () => {
  for (const status of ['received', 'washing', 'ready_for_pickup']) {
    assert.equal(isCustomerItemsPending(activeRow(status)), true, `${status} should be pending`);
  }
});

test('positive item quantities remove an order from pending coverage', () => {
  assert.equal(hasPositiveCustomerItems([{ quantity: 0 }, { quantity: 2 }]), true);
  assert.equal(isCustomerItemsPending(activeRow('received', { hasCustomerItems: true })), false);
  assert.equal(isCustomerItemsPending(activeRow('received', { hasCustomerItems: undefined })), false, 'missing coverage fails closed');
});

test('Completed, Cancelled, soft-deleted, and unsupported statuses are never pending', () => {
  for (const row of [
    activeRow('completed'),
    activeRow('cancelled'),
    activeRow('received', { deleted_at: '2026-09-18T01:00:00Z' }),
    activeRow('unknown'),
  ]) {
    assert.equal(isCustomerItemsPending(row), false);
  }
});

test('Owner and Staff action permissions follow transaction edit settings', () => {
  assert.equal(canEditCustomerItems('owner', false), true);
  assert.equal(canEditCustomerItems('staff', true), true);
  assert.equal(canEditCustomerItems('staff', false), false);
  assert.equal(customerItemsHref('order-123'), '/orders/order-123#customer-items');
});

test('pending coverage uses one scoped batch item query and listens for item changes', async () => {
  const source = await readFile(new URL('../src/hooks/useTransactions.ts', import.meta.url), 'utf8');
  assert.equal((source.match(/\.from\('transaction_customer_items'\)/g) ?? []).length, 1, 'coverage must use one item-table request');
  assert.match(source, /\.in\('transaction_id', transactionIds\)/);
  assert.match(source, /table: 'transaction_customer_items'/);
  assert.match(source, /hasCustomerItems: coveredIds\.has\(row\.id\)/);
});
