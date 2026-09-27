import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { canPrintDetails, getPrintDetailsError, resolvePrintDetails } from '../src/lib/print-details-state.ts'
import {
  buildThermalReceiptParts,
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

test('customer-item query failure in TransactionDetailPage blocks printing and displays clear error', () => {
  const result = resolvePrintDetails(
    { data: null, error: new Error('Database query timeout on customer items') },
    { data: [], error: null },
  )

  assert.equal(result.customerItems, null)
  assert.equal(result.serviceItemsError, null)
  assert.match(result.customerItemsError, /customer clothing items could not be loaded/)
  assert.equal(canPrintDetails(result.customerItems, result.serviceItems, getPrintDetailsError(result)), false)
})

test('service-item query failure in TransactionDetailPage blocks printing and displays clear error', () => {
  const result = resolvePrintDetails(
    { data: [{ id: 'ci-1', quantity: 2 }], error: null },
    { data: null, error: new Error('Network dropped connection on service items') },
  )

  assert.equal(result.serviceItems, null)
  assert.equal(result.customerItemsError, null)
  assert.match(result.serviceItemsError, /additional service lines could not be loaded/)
  assert.equal(canPrintDetails(result.customerItems, result.serviceItems, getPrintDetailsError(result)), false)
})

test('simultaneous customer-item and service-item query failures combine errors and block printing', () => {
  const result = resolvePrintDetails(
    { data: null, error: new Error('Customer item query timeout') },
    { data: null, error: new Error('Service item query timeout') },
  )

  assert.equal(result.customerItems, null)
  assert.equal(result.serviceItems, null)
  assert.match(getPrintDetailsError(result), /customer clothing items could not be loaded/)
  assert.equal(canPrintDetails(result.customerItems, result.serviceItems, getPrintDetailsError(result)), false)
})

test('successful queries returning empty lists are treated as valid loaded data without error or print blocking', () => {
  const result = resolvePrintDetails({ data: [], error: null }, { data: [], error: null })

  assert.deepEqual(result.customerItems, [])
  assert.deepEqual(result.serviceItems, [])
  assert.equal(result.customerItemsError, null)
  assert.equal(result.serviceItemsError, null)
  assert.equal(canPrintDetails(result.customerItems, result.serviceItems, getPrintDetailsError(result)), true)
})

test('unsupplied modal details remain a loading/fetch state while null details remain a failure', () => {
  assert.equal(getPrintDetailsError({
    customerItems: undefined,
    serviceItems: undefined,
    customerItemsError: null,
    serviceItemsError: null,
  }), null)
  assert.match(getPrintDetailsError({
    customerItems: null,
    serviceItems: [],
    customerItemsError: null,
    serviceItemsError: null,
  }), /clothing items/)
})

test('TransactionDetailPage preserves query failure as error and disables print action', async () => {
  const detailPage = await readFile(new URL('../src/pages/TransactionDetailPage.tsx', import.meta.url), 'utf8')

  // State definitions track nullable items and distinct error messages
  assert.match(detailPage, /useState<TransactionCustomerItem\[\] \| null>\(null\)/)
  assert.match(detailPage, /useState<TransactionServiceItem\[\] \| null>\(null\)/)
  assert.match(detailPage, /const \[customerItemsError, setCustomerItemsError\] = useState<string \| null>\(null\)/)
  assert.match(detailPage, /const \[serviceItemsError, setServiceItemsError\] = useState<string \| null>\(null\)/)

  // Passes both query outcomes through the same tested result resolver
  assert.match(detailPage, /resolvePrintDetails\(/)
  assert.match(detailPage, /setCustomerItems\(printDetails\.customerItems\)/)
  assert.match(detailPage, /setCustomerItemsError\(printDetails\.customerItemsError\)/)
  assert.match(detailPage, /setServiceItems\(printDetails\.serviceItems\)/)
  assert.match(detailPage, /setServiceItemsError\(printDetails\.serviceItemsError\)/)

  // Print button is disabled on loading or query errors
  assert.match(detailPage, /disabled=\{loading \|\| !canPrintDetails\(customerItems, serviceItems, customerItemsError \|\| serviceItemsError\)\}/)
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

  // Uses the tested shared resolver for null failures while allowing undefined to be fetched
  assert.match(modalCode, /getPrintDetailsError\(/)

  // Clearly notifies user when slip cannot be generated
  assert.match(modalCode, /Cannot Generate Slip/)
  assert.match(modalCode, /Printing is disabled to prevent producing slips with incomplete items or services/)

  // Print button is disabled with descriptive label when detailsError is set
  assert.match(modalCode, /disabled=\{printing \|\| loadingDetails \|\| !canPrintDetails\(customerItems, serviceItems, detailsError\)\}/)
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

