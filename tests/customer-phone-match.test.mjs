import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

process.env.VITE_SUPABASE_URL ??= 'https://customer-phone-match-test.invalid'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??= 'test-publishable-key'

const vite = await createServer({
  configFile: './vite.config.ts',
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
})

after(async () => {
  await vite.close()
})

const { default: TransactionForm } =
  await vite.ssrLoadModule('/src/components/TransactionForm.tsx')
const {
  findPhoneCustomerNameMismatch,
  isPhoneCustomerMatchSubmitAllowed,
  getPhoneCustomerDirectoryBlockMessage,
  PhoneCustomerMatchWarning,
} = TransactionForm

const existingCustomer = {
  id: 'customer-123',
  customer_code: 'CUS-1234567890ABCDEF',
  full_name: 'Joanne Umbay',
  phone_number: '09171234567',
  normalized_phone: '+639171234567',
  active: true,
  created_at: '2026-01-01T00:00:00.000Z',
}

function checkSubmit(input, customers = [existingCustomer]) {
  let submitted = false
  let warningCustomer = null
  const allowed = isPhoneCustomerMatchSubmitAllowed(input, customers, (customer) => {
    warningCustomer = customer
  })
  if (allowed) submitted = true
  return { allowed, submitted, warningCustomer }
}

test('mismatched name and normalized phone block submit and render the warning actions', () => {
  const input = {
    customer_id: '',
    customer_name: 'Azis Macalabo',
    phone_number: '+63 917-123-4567',
  }
  const result = checkSubmit(input)

  assert.equal(result.allowed, false)
  assert.equal(result.submitted, false)
  assert.equal(result.warningCustomer?.id, existingCustomer.id)
  assert.equal(findPhoneCustomerNameMismatch(input, [existingCustomer]), existingCustomer)

  const markup = renderToStaticMarkup(React.createElement(PhoneCustomerMatchWarning, {
    customer: existingCustomer,
    onUseCustomer() {},
    onDismiss() {},
  }))

  assert.match(markup, /role="alert"/)
  assert.match(markup, /already registered to <strong>Joanne Umbay<\/strong> \(CUS-1234567890ABCDEF\)/)
  assert.match(markup, /Use Joanne Umbay/)
  assert.match(markup, /Dismiss/)
})

test('matching name and phone allow submit without a warning', () => {
  const result = checkSubmit({
    customer_id: '',
    customer_name: '  joanne umbay  ',
    phone_number: '0917 123 4567',
  })

  assert.equal(result.allowed, true)
  assert.equal(result.submitted, true)
  assert.equal(result.warningCustomer, null)
})

test('an explicitly selected customer allows submit without a phone-name warning', () => {
  const result = checkSubmit({
    customer_id: existingCustomer.id,
    customer_name: 'Azis Macalabo',
    phone_number: existingCustomer.phone_number,
  })

  assert.equal(result.allowed, true)
  assert.equal(result.submitted, true)
  assert.equal(result.warningCustomer, null)
})

test('a summary-query failure does not block an unmatched order when the customer directory loaded', () => {
  const useCustomersResult = {
    loading: false,
    error: 'Customers loaded, but their summaries could not be refreshed. Try again.',
    customerDirectoryError: null,
  }
  const input = {
    customer_id: '',
    customer_name: 'New Customer',
    phone_number: '09170000000',
  }

  assert.ok(useCustomersResult.error, 'the unrelated summary query failed')
  assert.equal(
    getPhoneCustomerDirectoryBlockMessage(useCustomersResult.loading, useCustomersResult.customerDirectoryError),
    null,
  )
  assert.equal(
    getPhoneCustomerDirectoryBlockMessage(false, 'Could not load customers. Check the connection and try again.'),
    'Could not verify this phone number against customer records. Refresh the customer list before saving.',
  )
  const result = checkSubmit(input, [])
  assert.equal(result.allowed, true)
  assert.equal(result.submitted, true)
  assert.equal(result.warningCustomer, null)
})

test('duplicate phone matches use the same earliest-created customer as the database trigger', () => {
  const earlierCustomer = {
    ...existingCustomer,
    id: '00000000-0000-0000-0000-000000000002',
    customer_code: 'CUS-0000000000000002',
    full_name: 'Zulu Earlier',
    created_at: '2026-01-01T00:00:00.000Z',
  }
  const laterCustomer = {
    ...existingCustomer,
    id: '00000000-0000-0000-0000-000000000001',
    customer_code: 'CUS-0000000000000001',
    full_name: 'Aaron Later',
    created_at: '2026-02-01T00:00:00.000Z',
  }
  const input = {
    customer_id: '',
    customer_name: 'New Customer',
    phone_number: '09171234567',
  }

  assert.equal(findPhoneCustomerNameMismatch(input, [laterCustomer, earlierCustomer]), earlierCustomer)
  assert.equal(findPhoneCustomerNameMismatch(input, [earlierCustomer, laterCustomer]), earlierCustomer)
})
