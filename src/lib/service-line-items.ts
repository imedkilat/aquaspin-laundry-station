// Shared logic for "Add New Service" line items — additional services on the
// same order beyond the primary one recorded directly on the transaction.
// Used by both TransactionForm (new order) and EditTransactionModal (existing
// order), so the pricing/add-on/inventory math only lives in one place.
import type { AddOn, Service, TransactionAddOnItem, TransactionServiceItem, TransactionServiceItemInput } from '../types/database'
import {
  emptyInventoryUsageDraft,
  inventoryUsageHasAnyValue,
  inventoryUsageIsComplete,
  OTHER_INVENTORY_SOURCE,
  type InventoryUsageDraft,
} from '../hooks/useInventoryConsumables'

export type ServiceLineDraft = {
  localId: string
  service_id: string
  kg: string
  no_of_loads: string
  base_amount: string
  selectedAddOns: Record<string, number>
  useOwnInventory: boolean
  inventoryUsage: InventoryUsageDraft
}

export const emptyServiceLineDraft = (): ServiceLineDraft => ({
  localId: crypto.randomUUID(),
  service_id: '',
  kg: '',
  no_of_loads: '',
  base_amount: '',
  selectedAddOns: {},
  useOwnInventory: false,
  inventoryUsage: emptyInventoryUsageDraft(),
})

export const lineIsWeightBased = (service: Service | null | undefined) =>
  Boolean(service?.pricing_type === 'per_load_by_weight' && service.max_kg_per_load != null && service.max_kg_per_load > 0)

// Same auto-calculation TransactionForm already uses for the primary
// service: kg -> loads (rounded up to capacity) -> base amount.
export function recalcServiceLineFromKg(service: Service | null | undefined, kgValue: string) {
  if (!service) return { no_of_loads: '', base_amount: '' }
  if (lineIsWeightBased(service)) {
    const kg = parseFloat(kgValue)
    const loads = Number.isFinite(kg) && kg > 0 ? Math.ceil(kg / service.max_kg_per_load!) : 0
    const rate = service.default_rate ?? 0
    return {
      no_of_loads: loads > 0 ? String(loads) : '',
      base_amount: loads > 0 ? (loads * rate).toFixed(2) : '',
    }
  }
  return { no_of_loads: '', base_amount: service.default_rate != null ? String(service.default_rate) : '' }
}

export function lineAddOnItems(addOns: AddOn[], selected: Record<string, number>): TransactionAddOnItem[] {
  return addOns.flatMap((addOn) => {
    const quantity = selected[addOn.id] ?? 0
    if (quantity <= 0) return []
    const normalizedQuantity = addOn.unit_type === 'flat' ? 1 : quantity
    return [{
      add_on_id: addOn.id,
      name: addOn.name,
      unit_type: addOn.unit_type,
      unit_price: addOn.price,
      quantity: normalizedQuantity,
      line_total: Number((addOn.price * normalizedQuantity).toFixed(2)),
    }]
  })
}

export function lineAddOnsTotal(items: TransactionAddOnItem[]) {
  return items.reduce((sum, item) => sum + item.line_total, 0)
}

export function lineTotal(draft: ServiceLineDraft, addOns: AddOn[]) {
  const base = parseFloat(draft.base_amount) || 0
  const addOnsTotal = lineAddOnsTotal(lineAddOnItems(addOns, draft.selectedAddOns))
  return base + addOnsTotal
}

export function serviceLineDraftIsComplete(draft: ServiceLineDraft) {
  if (!draft.service_id) return false
  if (!draft.useOwnInventory) return true
  return inventoryUsageIsComplete(draft.inventoryUsage)
}

export function serviceLineDraftHasInventoryGap(draft: ServiceLineDraft) {
  return draft.useOwnInventory && !inventoryUsageIsComplete(draft.inventoryUsage) && inventoryUsageHasAnyValue(draft.inventoryUsage)
}

export function draftToServiceItemInput(draft: ServiceLineDraft, addOns: AddOn[]): TransactionServiceItemInput {
  const detergentCustomerSupplied = draft.inventoryUsage.detergent_item_id === OTHER_INVENTORY_SOURCE
  const conditionerCustomerSupplied = draft.inventoryUsage.fabric_conditioner_item_id === OTHER_INVENTORY_SOURCE
  const useInventory = draft.useOwnInventory && inventoryUsageIsComplete(draft.inventoryUsage)

  return {
    service_id: draft.service_id,
    kg: draft.kg ? Number(draft.kg) : null,
    no_of_loads: draft.no_of_loads ? Number(draft.no_of_loads) : null,
    base_amount: draft.base_amount ? Number(draft.base_amount) : 0,
    add_on_items: lineAddOnItems(addOns, draft.selectedAddOns),
    detergent_source: useInventory ? (detergentCustomerSupplied ? 'customer_supplied' : 'inventory') : null,
    detergent_item_id: useInventory && !detergentCustomerSupplied ? draft.inventoryUsage.detergent_item_id : null,
    detergent_quantity: useInventory && !detergentCustomerSupplied ? Number(draft.inventoryUsage.detergent_quantity) : null,
    detergent_other_reason: useInventory && detergentCustomerSupplied ? draft.inventoryUsage.detergent_other_reason.trim() : null,
    fabric_conditioner_source: useInventory ? (conditionerCustomerSupplied ? 'customer_supplied' : 'inventory') : null,
    fabric_conditioner_item_id: useInventory && !conditionerCustomerSupplied ? draft.inventoryUsage.fabric_conditioner_item_id : null,
    fabric_conditioner_quantity: useInventory && !conditionerCustomerSupplied ? Number(draft.inventoryUsage.fabric_conditioner_quantity) : null,
    fabric_conditioner_other_reason: useInventory && conditionerCustomerSupplied ? draft.inventoryUsage.fabric_conditioner_other_reason.trim() : null,
  }
}

export function serviceItemToDraft(item: TransactionServiceItem): ServiceLineDraft {
  const usesInventory = Boolean(item.detergent_source || item.fabric_conditioner_source)
  return {
    localId: item.id,
    service_id: item.service_id,
    kg: item.kg != null ? String(item.kg) : '',
    no_of_loads: item.no_of_loads != null ? String(item.no_of_loads) : '',
    base_amount: String(item.base_amount),
    selectedAddOns: Object.fromEntries((item.add_on_items ?? []).map((entry) => [entry.add_on_id, entry.quantity])),
    useOwnInventory: usesInventory,
    inventoryUsage: {
      detergent_item_id: item.detergent_source === 'customer_supplied' ? OTHER_INVENTORY_SOURCE : item.detergent_item_id ?? '',
      detergent_quantity: item.detergent_quantity != null ? String(item.detergent_quantity) : '',
      detergent_other_reason: item.detergent_other_reason ?? '',
      fabric_conditioner_item_id: item.fabric_conditioner_source === 'customer_supplied' ? OTHER_INVENTORY_SOURCE : item.fabric_conditioner_item_id ?? '',
      fabric_conditioner_quantity: item.fabric_conditioner_quantity != null ? String(item.fabric_conditioner_quantity) : '',
      fabric_conditioner_other_reason: item.fabric_conditioner_other_reason ?? '',
    },
  }
}
