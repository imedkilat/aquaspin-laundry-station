import type { AddOn, InventoryItem, Service } from '../types/database'
import {
  emptyServiceLineDraft,
  lineAddOnItems,
  lineAddOnsTotal,
  lineIsWeightBased,
  lineTotal,
  recalcServiceLineFromKg,
  type ServiceLineDraft,
} from '../lib/service-line-items'
import { emptyInventoryUsageDraft, type InventoryUsageDraft } from '../hooks/useInventoryConsumables'
import InventoryUsageFields from './InventoryUsageFields'

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'
const autoInputClass = `${inputClass} bg-slate-50 text-slate-700 cursor-not-allowed dark:bg-slate-800 dark:text-slate-300`
const labelClass = 'block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400'

type Props = {
  lines: ServiceLineDraft[]
  onChange: (lines: ServiceLineDraft[]) => void
  services: Service[]
  addOns: AddOn[]
  detergentItems: InventoryItem[]
  fabricConditionerItems: InventoryItem[]
  disabled?: boolean
}

export default function ServiceLineItemsEditor({
  lines,
  onChange,
  services,
  addOns,
  detergentItems,
  fabricConditionerItems,
  disabled = false,
}: Props) {
  const updateLine = (localId: string, patch: Partial<ServiceLineDraft>) => {
    onChange(lines.map((line) => (line.localId === localId ? { ...line, ...patch } : line)))
  }

  const handleServiceChange = (localId: string, serviceId: string) => {
    const service = services.find((s) => s.id === serviceId) ?? null
    const { no_of_loads, base_amount } = recalcServiceLineFromKg(service, '')
    updateLine(localId, { service_id: serviceId, kg: '', no_of_loads, base_amount })
  }

  const handleKgChange = (localId: string, line: ServiceLineDraft, kgValue: string) => {
    const service = services.find((s) => s.id === line.service_id) ?? null
    const { no_of_loads, base_amount } = recalcServiceLineFromKg(service, kgValue)
    updateLine(localId, { kg: kgValue, no_of_loads, base_amount })
  }

  const toggleAddOn = (localId: string, line: ServiceLineDraft, addOnId: string, checked: boolean) => {
    const next = { ...line.selectedAddOns }
    if (checked) next[addOnId] = 1
    else delete next[addOnId]
    updateLine(localId, { selectedAddOns: next })
  }

  const updateAddOnQuantity = (localId: string, line: ServiceLineDraft, addOnId: string, value: string, isDecimal: boolean) => {
    const parsed = Number(value)
    const quantity = Number.isFinite(parsed) && parsed > 0 ? (isDecimal ? parsed : Math.floor(parsed)) : 1
    updateLine(localId, { selectedAddOns: { ...line.selectedAddOns, [addOnId]: quantity } })
  }

  const toggleOwnInventory = (localId: string, checked: boolean) => {
    updateLine(localId, { useOwnInventory: checked, inventoryUsage: checked ? emptyInventoryUsageDraft() : emptyInventoryUsageDraft() })
  }

  const updateLineInventoryUsage = (localId: string, line: ServiceLineDraft, field: keyof InventoryUsageDraft, value: string) => {
    updateLine(localId, { inventoryUsage: { ...line.inventoryUsage, [field]: value } })
  }

  const removeLine = (localId: string) => {
    onChange(lines.filter((line) => line.localId !== localId))
  }

  const addLine = () => {
    onChange([...lines, emptyServiceLineDraft()])
  }

  const grandLinesTotal = lines.reduce((sum, line) => sum + lineTotal(line, addOns), 0)

  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50/40 p-4 dark:border-sky-900/60 dark:bg-sky-950/20">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Additional Services</h3>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Availing more than one service this visit (e.g. Wash-Dry-Fold plus Comforter/Special Item)? Add it here — it stays one order, one payment, one receipt.
          </p>
        </div>
        {lines.length > 0 && <span className="text-sm font-semibold text-sky-700 dark:text-sky-400">+{peso(grandLinesTotal)}</span>}
      </div>

      <div className="space-y-4">
        {lines.map((line, index) => {
          const service = services.find((s) => s.id === line.service_id) ?? null
          const isWeightBased = lineIsWeightBased(service)
          const addOnItems = lineAddOnItems(addOns, line.selectedAddOns)
          const addOnsTotal = lineAddOnsTotal(addOnItems)

          return (
            <div key={line.localId} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Service {index + 2}</span>
                <button type="button" disabled={disabled} onClick={() => removeLine(line.localId)} className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50">
                  Remove
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Service *</label>
                  <select required disabled={disabled} value={line.service_id} onChange={(e) => handleServiceChange(line.localId, e.target.value)} className={inputClass}>
                    <option value="">Select service…</option>
                    {services.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.code})</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Kg{isWeightBased ? ' *' : ''}</label>
                  <input type="number" step="0.1" min={isWeightBased ? '0.1' : '0'} required={Boolean(line.service_id) && isWeightBased} disabled={disabled || !line.service_id} value={line.kg} onChange={(e) => handleKgChange(line.localId, line, e.target.value)} className={`${inputClass} disabled:opacity-50`} />
                </div>
                <div>
                  <label className={labelClass}>No. of Loads{isWeightBased ? ' · Auto' : ''}</label>
                  <input type="number" min="0" readOnly={isWeightBased || !line.service_id} disabled={disabled || !line.service_id} value={line.no_of_loads} onChange={isWeightBased || !line.service_id ? undefined : (e) => updateLine(line.localId, { no_of_loads: e.target.value })} className={isWeightBased || !line.service_id ? autoInputClass : inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Base Amount (₱){isWeightBased ? ' · Auto' : ''}</label>
                  <input type="number" step="0.01" min="0" readOnly={isWeightBased || !line.service_id} disabled={disabled || !line.service_id} value={line.base_amount} onChange={isWeightBased || !line.service_id ? undefined : (e) => updateLine(line.localId, { base_amount: e.target.value })} className={isWeightBased || !line.service_id ? autoInputClass : inputClass} />
                </div>
              </div>

              {addOns.length > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Add-ons for this service</span>
                    {addOnItems.length > 0 && <span className="text-xs font-semibold text-sky-600">{peso(addOnsTotal)}</span>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {addOns.map((addOn) => {
                      const selected = (line.selectedAddOns[addOn.id] ?? 0) > 0
                      const quantity = line.selectedAddOns[addOn.id] ?? 1
                      const effectiveQuantity = addOn.unit_type === 'flat' ? 1 : quantity
                      const decimalQuantity = addOn.unit_type === 'kg'
                      return (
                        <label key={addOn.id} className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs cursor-pointer ${selected ? 'border-sky-300 bg-sky-50/60 dark:border-sky-800' : 'border-slate-200 dark:border-slate-700'}`}>
                          <span className="flex items-center gap-1.5">
                            <input type="checkbox" disabled={disabled} checked={selected} onChange={(e) => toggleAddOn(line.localId, line, addOn.id, e.target.checked)} />
                            {addOn.name}
                          </span>
                          {selected ? (
                            <input type="number" min={decimalQuantity ? '0.1' : '1'} step={decimalQuantity ? '0.1' : '1'} disabled={disabled || addOn.unit_type === 'flat'} value={effectiveQuantity} onChange={(e) => updateAddOnQuantity(line.localId, line, addOn.id, e.target.value, decimalQuantity)} onClick={(e) => e.stopPropagation()} className="w-14 rounded border border-slate-300 px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-950" />
                          ) : (
                            <span className="text-slate-400">{peso(addOn.price)}</span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              <label className="mt-3 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                <input type="checkbox" disabled={disabled} checked={line.useOwnInventory} onChange={(e) => toggleOwnInventory(line.localId, e.target.checked)} />
                This service used its own detergent / fabric conditioner (leave unchecked if it shared the wash above)
              </label>
              {line.useOwnInventory && (
                <div className="mt-2">
                  <InventoryUsageFields
                    usage={line.inventoryUsage}
                    detergentItems={detergentItems}
                    fabricConditionerItems={fabricConditionerItems}
                    disabled={disabled}
                    onChange={(field, value) => updateLineInventoryUsage(line.localId, line, field, value)}
                  />
                </div>
              )}

              <div className="mt-3 flex justify-end text-sm">
                <span className="text-slate-500 mr-2">Line total</span>
                <strong className="text-slate-900 dark:text-slate-100">{peso(lineTotal(line, addOns))}</strong>
              </div>
            </div>
          )
        })}
      </div>

      <button type="button" disabled={disabled} onClick={addLine} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50 dark:border-sky-800 dark:bg-slate-900 dark:text-sky-400">
        + Add Service
      </button>
    </section>
  )
}
