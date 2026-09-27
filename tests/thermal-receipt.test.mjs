import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildThermalReceiptParts,
  escapeHtml,
  openThermalPrintWindow,
  paymentLabel,
  peso,
  writeThermalPrintDocument,
} from '../src/lib/thermal-receipt.ts'

const makeTransaction = (overrides = {}) => ({
  id: 'tx-12345678-0000-0000-0000-000000000001',
  transaction_code: 'AQ-QA-THERMAL-1',
  transaction_no: 42,
  transaction_date: '2026-09-28',
  customer_name: 'Maria Santos',
  phone_number: '09171234567',
  created_by_profile: { full_name: 'Staff Attendant' },
  service_label_snapshot: 'Wash-Dry-Fold',
  service_code_snapshot: 'WDF',
  services: { code: 'WDF', label: 'Wash-Dry-Fold' },
  kg: 7,
  no_of_loads: 1,
  base_amount: 180,
  add_on_items: [],
  discount_amount: 0,
  discount_promo_name_snapshot: null,
  total_amount: 180,
  cash_amount: null,
  gcash_amount: null,
  gcash_reference: null,
  payment_method: 'paid',
  pickup_date: '2026-09-29',
  pickup_time: '17:00',
  notes: 'Fragile clothes handle with care',
  detergent_source: 'inventory',
  detergent_quantity: 1,
  fabric_conditioner_source: 'inventory',
  fabric_conditioner_quantity: 1,
  order_status: 'received',
  deleted_at: null,
  created_at: '2026-09-28T08:00:00.000Z',
  updated_at: '2026-09-28T08:00:00.000Z',
  ...overrides,
})

test('thermal receipt formats single-service order with base amount, add-ons, and total', () => {
  const transaction = makeTransaction({
    base_amount: 180,
    add_on_items: [
      { add_on_id: 'ao-1', name: 'Bleach Treatment', unit_type: 'dose', unit_price: 25, quantity: 1, line_total: 25 },
    ],
    total_amount: 205,
  })

  const { receiptHtml } = buildThermalReceiptParts({ transaction, mode: 'receipt' })

  assert.match(receiptHtml, /CLAIM TICKET/)
  assert.match(receiptHtml, /AQ-QA-THERMAL-1/)
  assert.match(receiptHtml, /Maria Santos/)
  assert.match(receiptHtml, /Wash-Dry-Fold/)
  assert.match(receiptHtml, /7 kg \(1 load\)/)
  assert.match(receiptHtml, /Bleach Treatment/)
  assert.match(receiptHtml, /₱25\.00/)
  assert.match(receiptHtml, /TOTAL AMOUNT:/)
  assert.match(receiptHtml, /₱205\.00/)
})

test('thermal receipt reconciles multi-service order totals across all service lines', () => {
  const transaction = makeTransaction({
    base_amount: 180,
    kg: 7,
    no_of_loads: 1,
    add_on_items: [],
    total_amount: 530, // 180 (primary) + 250 (comforter) + 100 (delicate)
  })

  const serviceItems = [
    {
      id: 'si-1',
      transaction_id: transaction.id,
      position: 1,
      service_id: 'srv-comforter',
      service_label_snapshot: 'Comforter / Bedding',
      service_code_snapshot: 'CFB',
      kg: 5,
      no_of_loads: 1,
      base_amount: 250,
      add_ons: 0,
      add_on_items: [],
      total_amount: 250,
      detergent_source: 'inventory',
      detergent_item_id: 'det-1',
      detergent_quantity: 2,
      detergent_other_reason: null,
      fabric_conditioner_source: null,
      fabric_conditioner_item_id: null,
      fabric_conditioner_quantity: null,
      fabric_conditioner_other_reason: null,
      created_at: '2026-09-28T08:00:00.000Z',
      created_by: 'staff-1',
    },
    {
      id: 'si-2',
      transaction_id: transaction.id,
      position: 2,
      service_id: 'srv-delicate',
      service_label_snapshot: 'Handwash Delicate',
      service_code_snapshot: 'HWD',
      kg: 2,
      no_of_loads: 1,
      base_amount: 80,
      add_ons: 20,
      add_on_items: [
        { add_on_id: 'ao-scent', name: 'Fabric Perfume', unit_type: 'spray', unit_price: 20, quantity: 1, line_total: 20 },
      ],
      total_amount: 100,
      detergent_source: 'customer_supplied',
      detergent_item_id: null,
      detergent_quantity: null,
      detergent_other_reason: 'Delicate Wool Wash',
      fabric_conditioner_source: null,
      fabric_conditioner_item_id: null,
      fabric_conditioner_quantity: null,
      fabric_conditioner_other_reason: null,
      created_at: '2026-09-28T08:00:00.000Z',
      created_by: 'staff-1',
    },
  ]

  const { receiptHtml } = buildThermalReceiptParts({
    transaction,
    serviceItems,
    mode: 'receipt',
  })

  // Primary service
  assert.match(receiptHtml, /Wash-Dry-Fold/)
  assert.match(receiptHtml, /₱180\.00/)

  // Additional services
  assert.match(receiptHtml, /Comforter \/ Bedding/)
  assert.match(receiptHtml, /5 kg \(1 load\)/)
  assert.match(receiptHtml, /₱250\.00/)

  assert.match(receiptHtml, /Handwash Delicate/)
  assert.match(receiptHtml, /Fabric Perfume/)
  assert.match(receiptHtml, /₱20\.00/)

  // Reconciled grand total
  assert.match(receiptHtml, /TOTAL AMOUNT \(3 services\):/)
  assert.match(receiptHtml, /₱530\.00/)
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

test('QR code generation calls signed-link issuer and uses /track#v1.… path; never uses order code as access authorization', async () => {
  const transaction = makeTransaction({
    id: 'tx-uuid-1234',
    transaction_code: 'AQ-SENSITIVE-CODE',
    transaction_no: 9999,
  })

  let requestedTransactionId = null
  const mockSignedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-zK'
  const mockSignedPath = `/track#v1.${mockSignedToken}`

  let writtenHtml = ''
  const mockWindow = {
    opener: {},
    document: {
      open() {},
      write(content) { writtenHtml = content },
      close() {},
    },
  }

  await openThermalPrintWindow({
    transaction,
    targetWindow: mockWindow,
    resolveTrackingPath: async (txId) => {
      requestedTransactionId = txId
      return mockSignedPath
    },
  })

  // 1. Must call signed-link issuer with transaction.id
  assert.equal(requestedTransactionId, 'tx-uuid-1234')

  // 2. The QR SVG must be rendered in document
  assert.match(writtenHtml, /<svg\b[^>]*>/i)

  // 3. The QR SVG and document must NOT contain /track/AQ-SENSITIVE-CODE or /track/9999
  assert.doesNotMatch(writtenHtml, /\/track\/AQ-SENSITIVE-CODE/)
  assert.doesNotMatch(writtenHtml, /\/track\/9999/)
})

test('QR code generation does NOT fall back to order code if signed link issuer fails', async () => {
  const transaction = makeTransaction({
    id: 'tx-uuid-5678',
    transaction_code: 'AQ-CODE-FALLBACK-TEST',
    transaction_no: 8888,
  })

  let writtenHtml = ''
  const mockWindow = {
    opener: {},
    document: {
      open() {},
      write(content) { writtenHtml = content },
      close() {},
    },
  }

  // Issuer throws an error
  await openThermalPrintWindow({
    transaction,
    targetWindow: mockWindow,
    resolveTrackingPath: async () => {
      throw new Error('Signed link issuer service offline')
    },
  })

  // Must NOT include fallback to /track/AQ-CODE-FALLBACK-TEST
  assert.doesNotMatch(writtenHtml, /\/track\/AQ-CODE-FALLBACK-TEST/)
  assert.doesNotMatch(writtenHtml, /\/track\/8888/)
  // Must NOT render a QR SVG if the signed link could not be issued
  assert.doesNotMatch(writtenHtml, /<svg\b[^>]*>/i)
})
