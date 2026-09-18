import type { ChangeEvent } from 'react'
import type { InventoryItem } from '../types/database'
import type { InventoryUsageDraft } from '../hooks/useInventoryConsumables'

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

export default function InventoryUsageFields({
  usage,
  detergentItems,
  fabricConditionerItems,
  loading = false,
  disabled = false,
  onChange,
}: Props) {
  const detergent = detergentItems.find((item) => item.id === usage.detergent_item_id)
  const fabricConditioner = fabricConditionerItems.find((item) => item.id === usage.fabric_conditioner_item_id)

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Inventory Used *</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Required for stock tracking. These quantities will be deducted when the order becomes Completed.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Liquid Detergent Item *</label>
          <select
            required
            disabled={loading || disabled}
            value={usage.detergent_item_id}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange('detergent_item_id', event.target.value)}
            className={inputClass + ' disabled:cursor-not-allowed disabled:opacity-60'}
          >
            <option value="">{loading ? 'Loading detergent items…' : 'Select detergent item…'}</option>
            {detergentItems.map((item) => (
              <option key={item.id} value={item.id}>{item.item_name} ({item.unit_label})</option>
            ))}
          </select>
          <label className={labelClass + ' mt-3'}>Quantity {detergent ? '(' + detergent.unit_label + ')' : ''} *</label>
          <input
            required
            type="number"
            min="0.001"
            step={detergent ? stepFor(detergent.unit_label) : '0.001'}
            disabled={!detergent || disabled}
            value={usage.detergent_quantity}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onChange('detergent_quantity', event.target.value)}
            className={inputClass + ' disabled:cursor-not-allowed disabled:opacity-60'}
            placeholder={detergent ? 'Quantity in ' + detergent.unit_label : 'Select an item first'}
          />
        </div>

        <div>
          <label className={labelClass}>Fabric Conditioner Item *</label>
          <select
            required
            disabled={loading || disabled}
            value={usage.fabric_conditioner_item_id}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange('fabric_conditioner_item_id', event.target.value)}
            className={inputClass + ' disabled:cursor-not-allowed disabled:opacity-60'}
          >
            <option value="">{loading ? 'Loading conditioner items…' : 'Select fabric conditioner item…'}</option>
            {fabricConditionerItems.map((item) => (
              <option key={item.id} value={item.id}>{item.item_name} ({item.unit_label})</option>
            ))}
          </select>
          <label className={labelClass + ' mt-3'}>Quantity {fabricConditioner ? '(' + fabricConditioner.unit_label + ')' : ''} *</label>
          <input
            required
            type="number"
            min="0.001"
            step={fabricConditioner ? stepFor(fabricConditioner.unit_label) : '0.001'}
            disabled={!fabricConditioner || disabled}
            value={usage.fabric_conditioner_quantity}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onChange('fabric_conditioner_quantity', event.target.value)}
            className={inputClass + ' disabled:cursor-not-allowed disabled:opacity-60'}
            placeholder={fabricConditioner ? 'Quantity in ' + fabricConditioner.unit_label : 'Select an item first'}
          />
        </div>
      </div>
    </section>
  )
}
