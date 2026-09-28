import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

process.env.VITE_SUPABASE_URL ??= 'https://inventory-quantity-test.invalid'
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

const { default: InventoryUsageFields } = await vite.ssrLoadModule('/src/components/InventoryUsageFields.tsx')
const { inventoryUsageIsComplete, inventoryUsageQuantityError } = await vite.ssrLoadModule('/src/hooks/useInventoryConsumables.ts')
const { isValidUnitQuantity } = await vite.ssrLoadModule('/src/lib/inventory-quantity.ts')

const detergentPcs = { id: 'detergent-pcs', item_name: 'Detergent sachet', unit_label: 'pcs' }
const usage = (quantity) => ({
  detergent_item_id: detergentPcs.id,
  detergent_quantity: quantity,
  detergent_other_reason: '',
  fabric_conditioner_item_id: 'other',
  fabric_conditioner_quantity: '',
  fabric_conditioner_other_reason: 'Customer provided',
})

test('quantity validation accepts whole-number pcs and rejects decimal pcs', () => {
  assert.equal(isValidUnitQuantity('90', 'pcs'), true)
  assert.equal(isValidUnitQuantity('90.5', 'pcs'), false)
  assert.equal(isValidUnitQuantity('90.5', 'ml'), true)
})

test('inventory usage validation rejects decimal pcs while accepting whole pcs', () => {
  assert.equal(inventoryUsageIsComplete(usage('90'), [detergentPcs], []), true)
  assert.equal(inventoryUsageIsComplete(usage('90.5'), [detergentPcs], []), false)
  assert.equal(
    inventoryUsageQuantityError(usage('90.5'), [detergentPcs], []),
    'Liquid Detergent quantity for pcs items must be a whole number.',
  )
})

test('rendered pcs quantity input uses step 1 and shows a decimal validation message', () => {
  const markup = renderToStaticMarkup(React.createElement(InventoryUsageFields, {
    usage: usage('90.5'),
    detergentItems: [detergentPcs],
    fabricConditionerItems: [],
  }))

  assert.match(markup, /type="number" min="0\.001" step="1"/)
  assert.match(markup, /aria-invalid="true"/)
  assert.match(markup, /Quantity for pcs items must be a whole number\./)
})
