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
  PhoneCustomerMatchWarning,
} = TransactionForm

const existingCustomer = {
  id: 'customer-123',
  customer_code: 'CUS-1234567890ABCDEF',
  full_name: 'Joanne Umbay',
  phone_number: '09171234567',
  normalized_phone: '+639171234567',
  active: true,
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
