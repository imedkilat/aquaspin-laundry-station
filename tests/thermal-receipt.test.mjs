import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildThermalReceiptParts,
  buildThermalDocumentHtml,
  writeThermalPrintDocument,
  openThermalPrintWindow,
} from '../src/lib/thermal-receipt.ts'

const makeTransaction = (overrides = {}) => ({
  id: 'tx-123',
  transaction_code: 'AQ-QA-THERMAL-1',
  transaction_no: 101,
  transaction_date: '2026-09-28',
  customer_name: 'Maria Clara',
  phone_number: '09171234567',
  created_by_profile: { full_name: 'Staff Attendant' },
  service_label_snapshot: 'Wash-Dry-Fold',
  service_code_snapshot: 'WDF',
  services: { code: 'WDF', label: 'Wash-Dry-Fold' },
  add_on_items: [],
  base_amount: 180,
  kg: 7,
  no_of_loads: 1,
  payment_method: 'paid',
  cash_amount: 500,
  gcash_amount: 0,
  gcash_reference: null,
  total_amount: 180,
  discount_amount: 0,
  discount_promo_name_snapshot: null,
  pickup_date: '2026-09-29',
  pickup_time: '17:00:00',
  notes: 'Fragile fabric, gentle fold',
  created_at: '2026-09-28T08:30:00.000Z',
  ...overrides,
})

test('thermal receipt displays all service lines and calculates amounts correctly for multi-service orders', () => {
  const transaction = makeTransaction({
    base_amount: 180,
    add_on_items: [
      { add_on_id: 'ao-1', name: 'Liquid Detergent', unit_type: 'dose', unit_price: 15, quantity: 2, line_total: 30 },
    ],
    discount_amount: 20,
    discount_promo_name_snapshot: 'Loyalty Voucher',
    // Grand total: (180 + 30) - 20 [service 1 subtotal after discount] + 250 [service 2 base] + 15 [service 2 addon] = 455
    total_amount: 455,
  })

  const serviceItems = [
    {
      id: 'si-1',
      transaction_id: 'tx-123',
      position: 1,
      service_id: 'srv-comforter',
      service_label_snapshot: 'Comforter Care',
      service_code_snapshot: 'CSDB',
      kg: 4,
      no_of_loads: 1,
      base_amount: 250,
      add_ons: 15,
      add_on_items: [
        { add_on_id: 'ao-2', name: 'Fabcon Softener', unit_type: 'ml', unit_price: 15, quantity: 1, line_total: 15 },
      ],
      total_amount: 265,
      detergent_source: 'customer_supplied',
      detergent_item_id: null,
      detergent_quantity: null,
      detergent_other_reason: 'Own Ariel pods',
      fabric_conditioner_source: null,
      fabric_conditioner_item_id: null,
      fabric_conditioner_quantity: null,
      fabric_conditioner_other_reason: null,
      created_at: '2026-09-28T08:30:00.000Z',
      created_by: 'staff-1',
    },
  ]

  const { receiptHtml } = buildThermalReceiptParts({
    transaction,
    serviceItems,
    shopName: 'Aquaspin Test',
  })

  // Primary service check
  assert.match(receiptHtml, /Wash-Dry-Fold/)
  assert.match(receiptHtml, /7 kg \(1 load\)/)
  assert.match(receiptHtml, /₱180\.00/)
  assert.match(receiptHtml, /Liquid Detergent/)
  assert.match(receiptHtml, /₱30\.00/)

  // Additional service line check
  assert.match(receiptHtml, /Comforter Care/)
  assert.match(receiptHtml, /4 kg \(1 load\)/)
  assert.match(receiptHtml, /₱250\.00/)
  assert.match(receiptHtml, /Fabcon Softener/)
  assert.match(receiptHtml, /₱15\.00/)

  // Discount check
  assert.match(receiptHtml, /Discount \(Loyalty Voucher\):/)
  assert.match(receiptHtml, /-₱20\.00/)

  // Grand total check with service count
  assert.match(receiptHtml, /TOTAL AMOUNT \(2 services\):/)
  assert.match(receiptHtml, /₱455\.00/)
})

test('thermal receipt formats payment methods (Cash tendered/change, GCash, Pay Later)', () => {
  // 1. Paid Cash with change
  const cashTx = makeTransaction({
    payment_method: 'paid',
    cash_amount: 500,
    total_amount: 180,
  })
  const { receiptHtml: cashHtml } = buildThermalReceiptParts({ transaction: cashTx })
  assert.match(cashHtml, /<span>Payment:<\/span><span[^>]*>Cash<\/span>/)
  assert.match(cashHtml, /<span>Tendered:<\/span><span>₱500\.00<\/span>/)
  assert.match(cashHtml, /<span>Change:<\/span><span>₱320\.00<\/span>/)

  // 2. GCash
  const gcashTx = makeTransaction({
    payment_method: 'gcash',
    gcash_reference: 'GCASH-998877',
    total_amount: 180,
  })
  const { receiptHtml: gcashHtml } = buildThermalReceiptParts({ transaction: gcashTx })
  assert.match(gcashHtml, /<span>Payment:<\/span><span[^>]*>GCash<\/span>/)
  assert.match(gcashHtml, /<span>GCash Ref:<\/span><span[^>]*>GCASH-998877<\/span>/)

  // 3. Pay Later
  const payLaterTx = makeTransaction({
    payment_method: 'pay_later',
    total_amount: 180,
  })
  const { receiptHtml: payLaterHtml } = buildThermalReceiptParts({ transaction: payLaterTx })
  assert.match(payLaterHtml, /<span>Payment:<\/span><span[^>]*>Pay Later<\/span>/)
  assert.match(payLaterHtml, /\*\*\* UNPAID - PAY ON PICKUP \*\*\*/)
})

test('bag tag displays clothing-item counts when customerItems are present', () => {
  const transaction = makeTransaction()
  const customerItems = [
    { id: 'ci-1', transaction_id: 'tx-123', item_type: 't_shirts', quantity: 5, custom_item_name: null, created_at: '', updated_at: '', created_by: '', updated_by: '' },
    { id: 'ci-2', transaction_id: 'tx-123', item_type: 'pants', quantity: 3, custom_item_name: null, created_at: '', updated_at: '', created_by: '', updated_by: '' },
    { id: 'ci-3', transaction_id: 'tx-123', item_type: 'custom', quantity: 2, custom_item_name: 'Bedsheet Set', created_at: '', updated_at: '', created_by: '', updated_by: '' },
  ]

  const { bagTagHtml } = buildThermalReceiptParts({
    transaction,
    customerItems,
    mode: 'bag_tag',
  })

  assert.match(bagTagHtml, /Garment Count \(10 items\):/)
  assert.match(bagTagHtml, /5x t shirts/)
  assert.match(bagTagHtml, /3x pants/)
  assert.match(bagTagHtml, /2x Bedsheet Set/)
})

test('bag tag does not silently show an incomplete bag tag when drop-off clothing items are missing', () => {
  const transaction = makeTransaction({
    service_code_snapshot: 'WDF', // Drop-off service code
  })

  // No customer items passed / 0 items
  const { bagTagHtml } = buildThermalReceiptParts({
    transaction,
    customerItems: [],
    mode: 'bag_tag',
  })

  // Must show an explicit alert instead of omitting the section
  assert.match(bagTagHtml, /\*\*\* NO GARMENT COUNT RECORDED \*\*\*/)
  assert.match(bagTagHtml, /Clothing items pending count \/ check-in/)
})

test('bag tag displays all services and total rollup for multi-service orders', () => {
  const transaction = makeTransaction({
    service_label_snapshot: 'Wash-Dry-Fold',
    kg: 6,
    no_of_loads: 1,
    detergent_source: 'inventory',
    detergent_quantity: 2,
  })

  const serviceItems = [
    {
      id: 'si-1',
      transaction_id: 'tx-123',
      position: 1,
      service_id: 'srv-comforter',
      service_label_snapshot: 'Comforter Heavy',
      service_code_snapshot: 'CSDB',
      kg: 5,
      no_of_loads: 1,
      base_amount: 250,
      add_ons: 0,
      add_on_items: [],
      total_amount: 250,
      detergent_source: 'customer_supplied',
      detergent_item_id: null,
      detergent_quantity: null,
      detergent_other_reason: null,
      fabric_conditioner_source: null,
      fabric_conditioner_item_id: null,
      fabric_conditioner_quantity: null,
      fabric_conditioner_other_reason: null,
      created_at: '2026-09-28T08:30:00.000Z',
      created_by: 'staff-1',
    },
  ]

  const { bagTagHtml } = buildThermalReceiptParts({
    transaction,
    serviceItems,
    mode: 'bag_tag',
  })

  assert.match(bagTagHtml, /Service 1:/)
  assert.match(bagTagHtml, /Wash-Dry-Fold/)
  assert.match(bagTagHtml, /6 kg · 1 Load/)
  assert.match(bagTagHtml, /Service 2:/)
  assert.match(bagTagHtml, /Comforter Heavy/)
  assert.match(bagTagHtml, /5 kg · 1 Load/)
  assert.match(bagTagHtml, /Customer Supplied/)
  assert.match(bagTagHtml, /Total Weight \/ Loads:/)
  assert.match(bagTagHtml, /11 kg · 2 Loads/)
})

test('mode "both" produces receipt and bag tag separated by page-break', () => {
  const transaction = makeTransaction()
  const { contentHtml } = buildThermalReceiptParts({
    transaction,
    mode: 'both',
  })

  assert.match(contentHtml, /receipt-slip/)
  assert.match(contentHtml, /page-break/)
  assert.match(contentHtml, /bag-tag-slip/)
})

test('thermal receipt and bag tag safely escape all HTML/XSS content', () => {
  const transaction = makeTransaction({
    customer_name: '<script>alert("hacked")</script>',
    phone_number: '"><img src=x onerror=alert(1)>',
    service_label_snapshot: 'Custom & Service <Special>',
    notes: '<b>Bold Note</b> & test',
    discount_promo_name_snapshot: 'Promo <"XSS">',
    gcash_reference: 'REF<123>&456',
    add_on_items: [
      { add_on_id: 'ao-x', name: '<script>Addon</script>', unit_type: 'dose', unit_price: 10, quantity: 1, line_total: 10 },
    ],
  })

  const customerItems = [
    { id: 'ci-x', transaction_id: 'tx-123', item_type: 'custom', quantity: 1, custom_item_name: '<iframe src=evil.com>', created_at: '', updated_at: '', created_by: '', updated_by: '' },
  ]

  const serviceItems = [
    {
      id: 'si-x',
      transaction_id: 'tx-123',
      position: 1,
      service_id: 'srv-x',
      service_label_snapshot: '<img src=x onerror=alert(2)>',
      service_code_snapshot: 'XSS',
      kg: 2,
      no_of_loads: 1,
      base_amount: 100,
      add_ons: 0,
      add_on_items: [],
      total_amount: 100,
      detergent_source: null,
      detergent_item_id: null,
      detergent_quantity: null,
      detergent_other_reason: null,
      fabric_conditioner_source: null,
      fabric_conditioner_item_id: null,
      fabric_conditioner_quantity: null,
      fabric_conditioner_other_reason: null,
      created_at: '',
      created_by: '',
    },
  ]

  const { contentHtml } = buildThermalReceiptParts({
    transaction,
    customerItems,
    serviceItems,
    shopName: '<script>Shop</script>',
    address: '<script>Address</script>',
    contactPhone: '<script>Phone</script>',
    reportFooter: '<script>Footer</script>',
    mode: 'both',
  })

  // Ensure no unescaped dangerous tags
  assert.doesNotMatch(contentHtml, /<script>/i)
  assert.doesNotMatch(contentHtml, /<iframe/i)
  assert.doesNotMatch(contentHtml, /<img\b/i)

  // Ensure escaped strings are present
  assert.match(contentHtml, /&lt;script&gt;alert\(&quot;hacked&quot;\)&lt;\/script&gt;/)
  assert.match(contentHtml, /&lt;script&gt;Shop&lt;\/script&gt;/)
  assert.match(contentHtml, /&lt;iframe src=evil\.com&gt;/)
})

test('writeThermalPrintDocument writes into target window and clears opener for popup safety', async () => {
  let writtenHtml = ''
  let closed = false
  let opened = false

  const mockWindow = {
    opener: {},
    document: {
      open() { opened = true },
      write(content) { writtenHtml = content },
      close() { closed = true },
    },
  }

  const transaction = makeTransaction()
  await openThermalPrintWindow({
    transaction,
    targetWindow: mockWindow,
    qrSvg: '<svg id="test-qr"></svg>',
  })

  assert.equal(mockWindow.opener, null)
  assert.equal(opened, true)
  assert.equal(closed, true)
  assert.match(writtenHtml, /test-qr/)
  assert.match(writtenHtml, /thermal-AQ-QA-THERMAL-1/)
  assert.match(writtenHtml, /window\.print\(\)/)
})

test('openThermalPrintWindow throws user-friendly error if popup is blocked', async () => {
  const transaction = makeTransaction()

  await assert.rejects(
    async () => {
      await openThermalPrintWindow({
        transaction,
        targetWindow: null, // Simulating popup blocker returning null
      })
    },
    {
      message: /Popup blocked\. Allow popups for Aquaspin to print thermal receipts\./,
    }
  )
})
