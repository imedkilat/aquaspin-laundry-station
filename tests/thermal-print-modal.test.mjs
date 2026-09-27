import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

process.env.VITE_SUPABASE_URL = 'https://test-project.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test-only'

const server = await createServer({
  configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  root: projectRoot,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
})

const [{ default: ThermalPrintModal }, { AuthProvider }, { ShopSettingsProvider }] = await Promise.all([
  server.ssrLoadModule('/src/components/ThermalPrintModal.tsx'),
  server.ssrLoadModule('/src/lib/auth-context.tsx'),
  server.ssrLoadModule('/src/lib/shop-settings-context.tsx'),
])

test.after(async () => {
  await server.close()
})

function renderModal({
  customerItems = [],
  serviceItems = [],
  customerItemsError = null,
  serviceItemsError = null,
  parentLoading = false,
} = {}) {
  const transaction = {
    id: 'test-transaction',
    transaction_code: 'AQ-TEST-PRINT',
    transaction_no: 1,
    transaction_date: '2026-09-28',
    customer_name: 'QA Customer',
    service_code_snapshot: 'WDF',
    service_label_snapshot: 'Wash-Dry-Fold',
    services: { code: 'WDF', label: 'Wash-Dry-Fold' },
    add_on_items: [],
    base_amount: 90,
    total_amount: 90,
    payment_method: 'pay_later',
    order_status: 'received',
  }

  const modal = React.createElement(ThermalPrintModal, {
    transaction,
    customerItems,
    serviceItems,
    customerItemsError,
    serviceItemsError,
    parentLoading,
    onClose() {},
  })

  return renderToStaticMarkup(
    React.createElement(AuthProvider, null,
      React.createElement(ShopSettingsProvider, null, modal),
    ),
  )
}

test('rendered modal blocks printing and shows loading while parent reloads retained details', () => {
  const html = renderModal({
    customerItems: [{ id: 'item', quantity: 2 }],
    serviceItems: [{ id: 'service', position: 1 }],
    parentLoading: true,
  })

  assert.match(html, /Loading order clothing items and services/)
  assert.match(html, /<button[^>]*disabled=""[^>]*>[\s\S]*?Loading details…[\s\S]*?<\/button>/)
})

test('rendered modal keeps printing disabled and explains failed detail queries', () => {
  const html = renderModal({
    customerItems: null,
    serviceItems: [],
    customerItemsError: 'Clothing query failed. Refresh and try again.',
  })

  assert.match(html, /Cannot Generate Slip/)
  assert.match(html, /Clothing query failed/)
  assert.match(html, /<button[^>]*disabled=""[^>]*>[\s\S]*?Print Disabled[\s\S]*?<\/button>/)
})

test('rendered modal permits printing when both detail queries succeeded with empty lists', () => {
  const html = renderModal({ customerItems: [], serviceItems: [] })
  const button = html.match(/<button[^>]*>[\s\S]*?Print Receipt[\s\S]*?<\/button>/)?.[0]

  assert.ok(button, 'receipt print button is rendered')
  assert.doesNotMatch(button, /disabled=/)
})
