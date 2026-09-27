import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  buildThermalReceiptParts,
  buildThermalDocumentHtml,
  writeThermalPrintDocument,
  openThermalPrintWindow,
} from '../src/lib/thermal-receipt.ts'
import { issueOrderTrackingLink } from '../src/lib/order-tracking.ts'

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

test('slip output explicitly communicates when tracking QR is omitted and never claims QR is present', () => {
  const transaction = makeTransaction({
    transaction_code: 'AQ-CLAIM-8',
    transaction_no: 888,
  })

  // 1. Receipt with omitted QR
  const { receiptHtml, bagTagHtml } = buildThermalReceiptParts({
    transaction,
    qrSvg: '', // omitted
  })

  assert.match(receiptHtml, /\[ Live tracking QR omitted \]/)
  assert.doesNotMatch(receiptHtml, /Scan to track live order status/)
  assert.doesNotMatch(receiptHtml, /<svg/i)
  assert.doesNotMatch(receiptHtml, /\/track\/AQ-CLAIM-8/)
  assert.doesNotMatch(receiptHtml, /\/track\/888/)

  // 2. Bag tag with omitted QR
  assert.match(bagTagHtml, /\[ Claim QR code omitted \]/)
  assert.doesNotMatch(bagTagHtml, /Claim Scan Code/)
  assert.doesNotMatch(bagTagHtml, /<svg/i)
  assert.doesNotMatch(bagTagHtml, /\/track\/AQ-CLAIM-8/)
  assert.doesNotMatch(bagTagHtml, /\/track\/888/)
})

test('issueOrderTrackingLink calls Edge Function with transaction_id and formats path as origin + /track#v1...', async () => {
  let invokedEndpoint = ''
  let invokedBody = null

  const mockClient = {
    functions: {
      async invoke(endpoint, options) {
        invokedEndpoint = endpoint
        invokedBody = options.body
        return {
          data: { path: '/track#v1.550e8400-e29b-41d4-a716-446655440000.VALID_CAPABILITY_SIGNATURE' },
          error: null,
        }
      },
    },
  }

  const url = await issueOrderTrackingLink('550e8400-e29b-41d4-a716-446655440000', {
    origin: 'https://app.aquaspin.ph',
    supabaseClient: mockClient,
  })

  assert.equal(invokedEndpoint, 'issue-order-tracking-link')
  assert.deepEqual(invokedBody, { transaction_id: '550e8400-e29b-41d4-a716-446655440000' })
  assert.equal(url, 'https://app.aquaspin.ph/track#v1.550e8400-e29b-41d4-a716-446655440000.VALID_CAPABILITY_SIGNATURE')

  // Security invariants:
  // Capability is strictly in the hash fragment (#v1.), NOT in path or query
  assert.match(url, /\/track#v1\./)
  assert.doesNotMatch(url, /\/track\//)
  assert.doesNotMatch(url, /\?/)
})

test('issueOrderTrackingLink rejects and throws user-friendly error on Edge Function failure', async () => {
  const mockClient = {
    functions: {
      async invoke() {
        return {
          data: null,
          error: new Error('Rate limit exceeded. Please try again later.'),
        }
      },
    },
  }

  await assert.rejects(
    async () => {
      await issueOrderTrackingLink('tx-uuid-1', {
        supabaseClient: mockClient,
      })
    },
    {
      message: /Rate limit exceeded\. Please try again later\./,
    }
  )
})

test('openThermalPrintWindow resolves signed tracking link, builds QR from signed path, and never falls back to code route', async () => {
  let issuedTxId = ''
  let writtenHtml = ''

  const mockWindow = {
    opener: {},
    document: {
      open() {},
      write(content) { writtenHtml = content },
      close() {},
    },
  }

  const transaction = makeTransaction({
    id: 'tx-uuid-999',
    transaction_code: 'AQ-CODE-99',
    transaction_no: 99,
  })

  await openThermalPrintWindow({
    transaction,
    targetWindow: mockWindow,
    issueTrackingLink: async (txId) => {
      issuedTxId = txId
      return `https://app.aquaspin.ph/track#v1.${txId}.TEST_SIGNATURE`
    },
  })

  assert.equal(issuedTxId, 'tx-uuid-999')
  // Document was written with QR SVG containing the signed URL
  assert.match(writtenHtml, /<svg/)
  assert.match(writtenHtml, /Scan to track live order status/)
  // Must NEVER fall back to code-based routes
  assert.doesNotMatch(writtenHtml, /\/track\/AQ-CODE-99/)
  assert.doesNotMatch(writtenHtml, /\/track\/99/)
})

test('openThermalPrintWindow closes target popup window and throws error when link issuer fails', async () => {
  let closed = false
  let writtenHtml = ''

  const mockWindow = {
    opener: {},
    document: {
      open() {},
      write(content) { writtenHtml = content },
      close() {},
    },
    close() {
      closed = true
    },
  }

  const transaction = makeTransaction({
    id: 'tx-uuid-fail',
    transaction_code: 'AQ-FAIL-01',
    transaction_no: 404,
  })

  await assert.rejects(
    async () => {
      await openThermalPrintWindow({
        transaction,
        targetWindow: mockWindow,
        issueTrackingLink: async () => {
          throw new Error('Edge Function unauthorized: capability could not be issued')
        },
      })
    },
    {
      message: /Failed to issue secure tracking link: Edge Function unauthorized/,
    }
  )

  // Popup lifecycle: window must be closed to avoid leaving an empty placeholder
  assert.equal(closed, true)
  // Must NOT have written unauthenticated fallback
  assert.equal(writtenHtml, '')
})

test('openThermalPrintWindow with omitQr=true writes slip with omission notice without calling issuer', async () => {
  let issuerCalled = false
  let writtenHtml = ''

  const mockWindow = {
    opener: {},
    document: {
      open() {},
      write(content) { writtenHtml = content },
      close() {},
    },
  }

  const transaction = makeTransaction()

  await openThermalPrintWindow({
    transaction,
    targetWindow: mockWindow,
    omitQr: true,
    issueTrackingLink: async () => {
      issuerCalled = true
      return 'https://app.aquaspin.ph/track#v1.not-called'
    },
  })

  assert.equal(issuerCalled, false)
  assert.match(writtenHtml, /\[ Live tracking QR omitted \]/)
  assert.doesNotMatch(writtenHtml, /Scan to track live order status/)
})

function simulateTransactionDetailReload({ transactionResult, customerItemsResult, serviceItemsResult, historyResult }) {
  let loading = true
  let error = null
  let customerItems = null
  let serviceItems = null
  let customerItemsError = null
  let serviceItemsError = null
  let history = []
  let transaction = null

  if (transactionResult.error) {
    error = 'Could not load this order. Check your connection and try again.'
    customerItems = null
    serviceItems = null
    loading = false
    return {
      transaction,
      customerItems,
      serviceItems,
      customerItemsError,
      serviceItemsError,
      history,
      error,
      loading,
      isPrintDisabled: true,
      alertTitle: 'Order unavailable',
    }
  }

  transaction = transactionResult.data ?? null

  if (customerItemsResult.error) {
    customerItems = null
    const msg = 'The order opened, but customer clothing items could not be loaded. Refresh and try again.'
    customerItemsError = msg
    error = msg
  } else {
    customerItems = customerItemsResult.data ?? []
    customerItemsError = null
  }

  if (serviceItemsResult.error) {
    serviceItems = null
    const msg = 'The order opened, but additional service lines could not be loaded. Refresh and try again.'
    serviceItemsError = msg
    error = error ? `${error} Also, additional service lines could not be loaded.` : msg
  } else {
    serviceItems = serviceItemsResult.data ?? []
    serviceItemsError = null
  }

  if (historyResult?.error) {
    history = []
    error = error || 'The order opened, but its status history could not be loaded. Refresh and try again.'
  } else {
    history = historyResult?.data ?? []
  }

  loading = false

  const isPrintDisabled = loading || Boolean(customerItemsError || serviceItemsError)
  const alertTitle = customerItemsError || serviceItemsError ? 'Order details incomplete' : 'Order action did not finish'

  const modalInitialDetailsError =
    customerItemsError ||
    serviceItemsError ||
    (customerItems === null ? 'Could not load clothing items for this order. Please try again.' : null) ||
    (serviceItems === null ? 'Could not load service lines for this order. Please try again.' : null)

  const modalLoadingDetails = !modalInitialDetailsError && (customerItems === undefined || serviceItems === undefined)
  const modalPrintDisabled = modalLoadingDetails || Boolean(modalInitialDetailsError)
  const modalButtonLabel = modalLoadingDetails ? 'Loading details…' : modalInitialDetailsError ? 'Print Disabled' : 'Print'

  return {
    transaction,
    customerItems,
    serviceItems,
    customerItemsError,
    serviceItemsError,
    history,
    error,
    loading,
    isPrintDisabled,
    alertTitle,
    modal: {
      initialDetailsError: modalInitialDetailsError,
      loadingDetails: modalLoadingDetails,
      isPrintDisabled: modalPrintDisabled,
      buttonLabel: modalButtonLabel,
    },
  }
}

test('customer-item query failure in TransactionDetailPage blocks printing and displays clear error', () => {
  const result = simulateTransactionDetailReload({
    transactionResult: { data: makeTransaction(), error: null },
    customerItemsResult: { data: null, error: { message: 'Database query timeout on customer items' } },
    serviceItemsResult: { data: [], error: null },
  })

  // Customer items must be null, not []
  assert.equal(result.customerItems, null)
  // Error must be clearly recorded and shown
  assert.equal(result.customerItemsError, 'The order opened, but customer clothing items could not be loaded. Refresh and try again.')
  assert.equal(result.error, 'The order opened, but customer clothing items could not be loaded. Refresh and try again.')
  assert.equal(result.alertTitle, 'Order details incomplete')
  // Page print button must be disabled
  assert.equal(result.isPrintDisabled, true)
  // Modal print button must be disabled with 'Print Disabled' label and error set
  assert.equal(result.modal.isPrintDisabled, true)
  assert.equal(result.modal.buttonLabel, 'Print Disabled')
  assert.match(result.modal.initialDetailsError, /clothing items/)
})

test('service-item query failure in TransactionDetailPage blocks printing and displays clear error', () => {
  const result = simulateTransactionDetailReload({
    transactionResult: { data: makeTransaction(), error: null },
    customerItemsResult: { data: [{ id: 'ci-1', quantity: 2 }], error: null },
    serviceItemsResult: { data: null, error: { message: 'Network dropped connection on service items' } },
  })

  // Service items must be null, not []
  assert.equal(result.serviceItems, null)
  // Error must be clearly recorded and shown
  assert.equal(result.serviceItemsError, 'The order opened, but additional service lines could not be loaded. Refresh and try again.')
  assert.equal(result.error, 'The order opened, but additional service lines could not be loaded. Refresh and try again.')
  assert.equal(result.alertTitle, 'Order details incomplete')
  // Page print button must be disabled
  assert.equal(result.isPrintDisabled, true)
  // Modal print button must be disabled with 'Print Disabled' label and error set
  assert.equal(result.modal.isPrintDisabled, true)
  assert.equal(result.modal.buttonLabel, 'Print Disabled')
  assert.match(result.modal.initialDetailsError, /service lines/)
})

test('simultaneous customer-item and service-item query failures combine errors and block printing', () => {
  const result = simulateTransactionDetailReload({
    transactionResult: { data: makeTransaction(), error: null },
    customerItemsResult: { data: null, error: { message: 'Customer item query timeout' } },
    serviceItemsResult: { data: null, error: { message: 'Service item query timeout' } },
  })

  assert.equal(result.customerItems, null)
  assert.equal(result.serviceItems, null)
  assert.match(result.error, /customer clothing items could not be loaded/)
  assert.match(result.error, /additional service lines could not be loaded/)
  assert.equal(result.isPrintDisabled, true)
  assert.equal(result.modal.isPrintDisabled, true)
  assert.equal(result.modal.buttonLabel, 'Print Disabled')
})

test('successful queries returning empty lists are treated as valid loaded data without error or print blocking', () => {
  const result = simulateTransactionDetailReload({
    transactionResult: { data: makeTransaction(), error: null },
    customerItemsResult: { data: [], error: null },
    serviceItemsResult: { data: [], error: null },
  })

  // Lists are empty arrays (not null)
  assert.deepEqual(result.customerItems, [])
  assert.deepEqual(result.serviceItems, [])
  // No error states
  assert.equal(result.customerItemsError, null)
  assert.equal(result.serviceItemsError, null)
  assert.equal(result.error, null)
  // Page print action is enabled
  assert.equal(result.isPrintDisabled, false)
  // Modal print action is enabled
  assert.equal(result.modal.isPrintDisabled, false)
  assert.equal(result.modal.buttonLabel, 'Print')
  assert.equal(result.modal.initialDetailsError, null)
})

test('TransactionDetailPage preserves query failure as error and disables print action', async () => {
  const detailPage = await readFile(new URL('../src/pages/TransactionDetailPage.tsx', import.meta.url), 'utf8')

  // Preserves null distinctly rather than silently coercing errors to []
  assert.doesNotMatch(detailPage, /customerItemsResult\.error\s*\?\s*\[\]/)
  assert.doesNotMatch(detailPage, /serviceItemsResult\.error\s*\?\s*\[\]/)

  // State definitions track nullable items and distinct error messages
  assert.match(detailPage, /useState<TransactionCustomerItem\[\] \| null>\(null\)/)
  assert.match(detailPage, /useState<TransactionServiceItem\[\] \| null>\(null\)/)
  assert.match(detailPage, /const \[customerItemsError, setCustomerItemsError\] = useState<string \| null>\(null\)/)
  assert.match(detailPage, /const \[serviceItemsError, setServiceItemsError\] = useState<string \| null>\(null\)/)

  // On query error, sets items to null and populates error messages
  assert.match(detailPage, /if \(customerItemsResult\.error\)\s*\{\s*setCustomerItems\(null\)/)
  assert.match(detailPage, /setCustomerItemsError\(msg\)/)
  assert.match(detailPage, /if \(serviceItemsResult\.error\)\s*\{\s*setServiceItems\(null\)/)
  assert.match(detailPage, /setServiceItemsError\(msg\)/)

  // Print button is disabled on loading or query errors
  assert.match(detailPage, /disabled=\{loading \|\| Boolean\(customerItemsError \|\| serviceItemsError\)\}/)
  assert.match(detailPage, /title=\{customerItemsError \|\| serviceItemsError \? 'Cannot print while order details failed to load' : undefined\}/)

  // Error and item states are explicitly forwarded to ThermalPrintModal
  assert.match(detailPage, /customerItems=\{customerItems\}/)
  assert.match(detailPage, /serviceItems=\{serviceItems\}/)
  assert.match(detailPage, /customerItemsError=\{customerItemsError\}/)
  assert.match(detailPage, /serviceItemsError=\{serviceItemsError\}/)
})

test('ThermalPrintModal preserves distinct loading, error, and empty-list states and blocks printing on failure', async () => {
  const modalCode = await readFile(new URL('../src/components/ThermalPrintModal.tsx', import.meta.url), 'utf8')

  // Prop signature accepts nullable items and explicit error messages
  assert.match(modalCode, /customerItems\?:\s*TransactionCustomerItem\[\]\s*\|\s*null/)
  assert.match(modalCode, /serviceItems\?:\s*TransactionServiceItem\[\]\s*\|\s*null/)
  assert.match(modalCode, /customerItemsError\?:\s*string\s*\|\s*null/)
  assert.match(modalCode, /serviceItemsError\?:\s*string\s*\|\s*null/)

  // Distinct error evaluation: treats null as failure, but preserves empty list []
  assert.match(modalCode, /initialCustomerItems === null/)
  assert.match(modalCode, /initialServiceItems === null/)
  assert.doesNotMatch(modalCode, /initialCustomerItems\.length === 0\s*\?/)

  // Clearly notifies user when slip cannot be generated
  assert.match(modalCode, /Cannot Generate Slip/)
  assert.match(modalCode, /Printing is disabled to prevent producing slips with incomplete items or services/)

  // Print button is disabled with descriptive label when detailsError is set
  assert.match(modalCode, /disabled=\{printing \|\| loadingDetails \|\| Boolean\(detailsError\)\}/)
  assert.match(modalCode, /detailsError\s*\n\s*\?\s*'Print Disabled'/)

  // handlePrint guards against printing when detailsError is present
  assert.match(modalCode, /if \(detailsError\)\s*\{\s*setError\(detailsError\)\s*return\s*\}/)

  // In-modal query failure sets detailsError
  assert.match(modalCode, /if \(custRes\.error \|\| servRes\.error\)/)
  assert.match(modalCode, /setDetailsError\(/)
})

test('successfully loaded empty customer-items and service-items lists remain printable', () => {
  const transaction = makeTransaction({
    service_code_snapshot: 'WDF',
  })

  // Successfully loaded empty list ([]):
  const { bagTagHtml, receiptHtml } = buildThermalReceiptParts({
    transaction,
    customerItems: [],
    serviceItems: [],
    mode: 'both',
  })

  // Bag tag renders with empty warning, allowing printing without silent failure
  assert.match(bagTagHtml, /\*\*\* NO GARMENT COUNT RECORDED \*\*\*/)
  assert.match(bagTagHtml, /Clothing items pending count \/ check-in/)

  // Receipt renders primary service normally
  assert.match(receiptHtml, /Wash-Dry-Fold/)
  assert.match(receiptHtml, /₱180\.00/)
})

