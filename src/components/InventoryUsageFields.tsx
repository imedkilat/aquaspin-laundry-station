import type { ChangeEvent } from 'react'
import type { InventoryItem } from '../types/database'
import {
  OTHER_INVENTORY_SOURCE,
  type InventoryUsageDraft,
} from '../hooks/useInventoryConsumables'

type Props = {
  usage: InventoryUsageDraft
  detergentItems: InventoryItem[]
  fabricConditionerItems: InventoryItem[]
  loading?: boolean
  disabled?: boolean
  onChange: (field: keyof InventoryUsageDraft, value: string) => void
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'
const labelClass = 'block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400'

const stepFor = (unit: InventoryItem['unit_label']) => (unit === 'pcs' ? '1' : '0.001')

function UsageSide({
  label,
  itemId,
  quantity,
  otherReason,
  items,
  loading,
  disabled,
  itemField,
  quantityField,
  reasonField,
  onChange,
}: {
  label: string
  itemId: string
  quantity: string
  otherReason: string
  items: InventoryItem[]
  loading: boolean
  disabled: boolean
  itemField: 'detergent_item_id' | 'fabric_conditioner_item_id'
  quantityField: 'detergent_quantity' | 'fabric_conditioner_quantity'
  reasonField: 'detergent_other_reason' | 'fabric_conditioner_other_reason'
  onChange: (field: keyof InventoryUsageDraft, value: string) => void
}) {
  const selectedItem = items.find((item) => item.id === itemId)
  const isOther = itemId === OTHER_INVENTORY_SOURCE

  return (
    <div>
      <label className={labelClass}>{label} *</label>
      <select
        required
        disabled={loading || disabled}
        value={itemId}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(itemField, event.target.value)}
        className={inputClass + ' disabled:cursor-not-allowed disabled:opacity-60'}
      >
        <option value="">{loading ? 'Loading items…' : 'Select item…'}</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>{item.item_name} ({item.unit_label})</option>
        ))}
        <option value={OTHER_INVENTORY_SOURCE}>Other / Customer-provided</option>
      </select>

      {isOther ? (
        <>
          <label className={labelClass + ' mt-3'}>Reason *</label>
          <input
            required
            value={otherReason}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(reasonField, event.target.value)}
            disabled={disabled}
            maxLength={500}
            className={inputClass + ' disabled:cursor-not-allowed disabled:opacity-60'}
            placeholder="Customer provided their own supply"
          />
          <p className="mt-1 text-xs text-slate-500">No inventory stock will be deducted for this side.</p>
        </>
      ) : (
        <>
          <label className={labelClass + ' mt-3'}>Quantity {selectedItem ? '(' + selectedItem.unit_label + ')' : ''} *</label>
          <input
            required
            type="number"
            min="0.001"
            step={selectedItem ? stepFor(selectedItem.unit_label) : '0.001'}
            disabled={!selectedItem || disabled}
            value={quantity}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(quantityField, event.target.value)}
            className={inputClass + ' disabled:cursor-not-allowed disabled:opacity-60'}
            placeholder={selectedItem ? 'Quantity in ' + selectedItem.unit_label : 'Select an item first'}
          />
        </>
      )}
    </div>
  )
}

export default function InventoryUsageFields({
  usage,
  detergentItems,
  fabricConditionerItems,
  loading = false,
  disabled = false,
  onChange,
}: Props) {
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Inventory Used *</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Choose an inventory item and quantity, or select Other / Customer-provided with a reason. Stock is deducted when the order becomes Completed.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <UsageSide
          label="Liquid Detergent"
          itemId={usage.detergent_item_id}
          quantity={usage.detergent_quantity}
          otherReason={usage.detergent_other_reason}
          items={detergentItems}
          loading={loading}
          disabled={disabled}
          itemField="detergent_item_id"
          quantityField="detergent_quantity"
          reasonField="detergent_other_reason"
          onChange={onChange}
        />
        <UsageSide
          label="Fabric Conditioner"
          itemId={usage.fabric_conditioner_item_id}
          quantity={usage.fabric_conditioner_quantity}
          otherReason={usage.fabric_conditioner_other_reason}
          items={fabricConditionerItems}
          loading={loading}
          disabled={disabled}
          itemField="fabric_conditioner_item_id"
          quantityField="fabric_conditioner_quantity"
          reasonField="fabric_conditioner_other_reason"
          onChange={onChange}
        />
      </div>
    </section>
  )
}
