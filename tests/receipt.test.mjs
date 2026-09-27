import assert from 'node:assert/strict'
import test from 'node:test'
import { writeReceiptDocument } from '../src/lib/receipt.ts'

const transaction = (overrides = {}) => ({
  transaction_code: 'AQ-QA-RECEIPT',
  transaction_no: 1,
  transaction_date: '2026-09-25',
  customer_name: 'QA Customer',
  created_by_profile: { full_name: 'QA Owner' },
  service_label_snapshot: 'Wash-Dry-Fold',
  service_code_snapshot: 'WDF',
  services: null,
  add_on_items: [],
  base_amount: 195,
  kg: 6,
  no_of_loads: 1,
  payment_method: 'gcash',
  gcash_reference: 'GCASH-QA-123',
  total_amount: 415,
  created_at: '2026-09-25T08:00:00.000Z',
  ...overrides,
})

function renderReceipt(options) {
  let html = ''
  let closed = false
  const receiptWindow = {
    opener: {},
    document: {
      write(value) { html = value },
      close() { closed = true },
    },
  }

  writeReceiptDocument(receiptWindow, options)
  return { html, closed, opener: receiptWindow.opener }
}

test('multi-service receipt lists each service and shows the grand total once', () => {
  const { html, closed } = renderReceipt({
    transaction: transaction(),
    serviceItems: [{
      service_label_snapshot: 'Comforter / Special Item',
      service_code_snapshot: 'CSDB',
      kg: 3,
      base_amount: 220,
      add_on_items: [],
    }],
    shopName: 'Aquaspin QA',
  })

  assert.equal(closed, true)
  assert.match(html, /Wash-Dry-Fold/)
  assert.match(html, /Comforter \/ Special Item/)
  assert.match(html, /\(3 kg\)/)
  assert.match(html, /Total \(2 services\)/)
  assert.equal((html.match(/₱415\.00/g) ?? []).length, 1)
})

test('receipt includes per-service add-ons and payment details', () => {
  const { html } = renderReceipt({
    transaction: transaction({
      payment_method: 'gcash',
      gcash_reference: 'GCASH-QA-123',
      add_on_items: [{ name: 'Sachet detergent', quantity: 1, unit_type: 'sachet', line_total: 8 }],
    }),
    serviceItems: [{
      service_label_snapshot: 'Comforter / Special Item',
      kg: 3,
      base_amount: 220,
      add_on_items: [{ name: 'Fabric conditioner', quantity: 2, unit_type: 'ml', line_total: 5 }],
    }],
    shopName: 'Aquaspin QA',
  })

  assert.match(html, /Sachet detergent/)
  assert.match(html, /Fabric conditioner/)
  assert.match(html, /GCASH-QA-123/)
  assert.match(html, /<strong>Payment<\/strong><span>GCash<\/span>/)
})

test('receipt escapes customer and shop-provided text', () => {
  const { html, opener } = renderReceipt({
    transaction: transaction({ customer_name: '<script>alert("x")</script>' }),
    shopName: '<img src=x onerror=alert(1)>',
    address: '<svg onload=alert(1)>',
    reportFooter: '<b>not markup</b>',
  })

  assert.equal(opener, null)
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(html, /&lt;svg onload=alert\(1\)&gt;/)
  assert.match(html, /&lt;b&gt;not markup&lt;\/b&gt;/)
  assert.doesNotMatch(html, /<script>alert\(/)
})

test('receipt includes page and print styles and triggers the browser print flow', () => {
  const { html } = renderReceipt({ transaction: transaction(), shopName: 'Aquaspin QA' })

  assert.match(html, /@page \{ size: auto; margin: 10mm; \}/)
  assert.ok(html.includes('@media print { button { display: none !important; } body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }'))
  assert.match(html, /window\.addEventListener\('load',[\s\S]*window\.print\(\)/)
})

test('Pay Later receipts use the expected label and omit GCash reference', () => {
  const { html } = renderReceipt({
    transaction: transaction({ payment_method: 'pay_later', gcash_reference: null }),
    shopName: 'Aquaspin QA',
  })

  assert.match(html, /<strong>Payment<\/strong><span>Pay Later<\/span>/)
  assert.doesNotMatch(html, /GCash reference/)
})
