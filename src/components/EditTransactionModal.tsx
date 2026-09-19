import { useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useServices } from '../hooks/useServices'
import { useAddOns } from '../hooks/useAddOns'
import { useShopSettings } from '../lib/shop-settings-context'
import type { PaymentMethod, TransactionAddOnItem, TransactionWithService } from '../types/database'
import { toTitleCaseName } from '../lib/text'
import { ButtonSpinner, InlineAlert, LoadingPanel } from './UiFeedback'
import InventoryUsageFields from './InventoryUsageFields'
import {
  emptyInventoryUsageDraft,
  OTHER_INVENTORY_SOURCE,
  inventoryUsageIsComplete,
  inventoryUsageHasAnyValue,
  useInventoryConsumables,
  type InventoryUsageDraft,
} from '../hooks/useInventoryConsumables'

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const unitLabel = (unit: string, quantity = 1) => {
  if (unit === 'flat') return 'flat'
  if (unit === 'ml') return 'ml'
  return quantity === 1 ? unit : `${unit}s`
}

type FormState = {
  customer_name: string
  phone_number: string
  transaction_date: string
  service_id: string
  kg: string
  no_of_loads: string
  base_amount: string
  add_ons: string
  total_amount: string
  cash_amount: string
  gcash_amount: string
  gcash_reference: string
  payment_method: PaymentMethod
  pickup_date: string
  pickup_time: string
  notes: string
}

function formToState(t: TransactionWithService): FormState {
  return {
    customer_name: t.customer_name,
    phone_number: t.phone_number ?? '',
    transaction_date: t.transaction_date,
    service_id: t.service_id ?? '',
    kg: t.kg != null ? String(t.kg) : '',
    no_of_loads: t.no_of_loads != null ? String(t.no_of_loads) : '',
    base_amount: String(t.base_amount),
    add_ons: String(t.add_ons),
    total_amount: String(t.total_amount),
    cash_amount: t.cash_amount ? String(t.cash_amount) : '',
    gcash_amount: t.gcash_amount ? String(t.gcash_amount) : '',
    gcash_reference: t.gcash_reference ?? '',
    payment_method: t.payment_method,
    pickup_date: t.pickup_date ?? '',
    pickup_time: t.pickup_time ? t.pickup_time.slice(0, 5) : '',
    notes: t.notes ?? '',
  }
}

function addOnsFromItems(items: TransactionAddOnItem[] | null | undefined): Record<string, number> {
  const map: Record<string, number> = {}
  for (const item of items ?? []) {
    if (item.add_on_id) map[item.add_on_id] = item.quantity
  }
  return map
}

function inventoryUsageFromTransaction(t: TransactionWithService): InventoryUsageDraft {
  return {
    ...emptyInventoryUsageDraft(),
    detergent_item_id: t.detergent_source === 'customer_supplied' ? OTHER_INVENTORY_SOURCE : t.detergent_item_id ?? '',
    detergent_quantity: t.detergent_quantity != null ? String(t.detergent_quantity) : '',
    detergent_other_reason: t.detergent_other_reason ?? '',
    fabric_conditioner_item_id: t.fabric_conditioner_source === 'customer_supplied' ? OTHER_INVENTORY_SOURCE : t.fabric_conditioner_item_id ?? '',
    fabric_conditioner_quantity: t.fabric_conditioner_quantity != null ? String(t.fabric_conditioner_quantity) : '',
    fabric_conditioner_other_reason: t.fabric_conditioner_other_reason ?? '',
  }
}

function inventoryUsageEquals(left: InventoryUsageDraft, right: InventoryUsageDraft) {
  return Object.keys(left).every((key) => {
    const field = key as keyof InventoryUsageDraft
    return left[field] === right[field]
  })
}

function addOnItemsSignature(items: TransactionAddOnItem[] | null | undefined) {
  return JSON.stringify(
    [...(items ?? [])]
      .map((item) => ({
        add_on_id: item.add_on_id,
        name: item.name,
        unit_type: item.unit_type,
        unit_price: item.unit_price,
        quantity: item.quantity,
        line_total: item.line_total,
      }))
      .sort((left, right) => left.add_on_id.localeCompare(right.add_on_id)),
  )
}

export default function EditTransactionModal({ transaction, onClose }: { transaction: TransactionWithService; onClose: () => void }) {
  const { services } = useServices()
  const { addOns, loading: addOnsLoading } = useAddOns({ includeInactive: true })
  const { settings } = useShopSettings()
  const { detergentItems, fabricConditionerItems, loading: inventoryLoading, error: inventoryError } = useInventoryConsumables()
  const [form, setForm] = useState<FormState>(() => formToState(transaction))
  const [selectedAddOns, setSelectedAddOns] = useState<Record<string, number>>(() => addOnsFromItems(transaction.add_on_items))
  const initialInventoryUsage = useMemo(() => inventoryUsageFromTransaction(transaction), [transaction])
  const [inventoryUsage, setInventoryUsage] = useState<InventoryUsageDraft>(() => inventoryUsageFromTransaction(transaction))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saveLockRef = useRef(false)

  const selectedService = useMemo(
    () => services.find((service) => service.id === form.service_id) ?? null,
    [form.service_id, services]
  )

  const selectedAddOnItems = useMemo<TransactionAddOnItem[]>(() => {
    return addOns.flatMap((addOn) => {
      const quantity = selectedAddOns[addOn.id] ?? 0
      if (quantity <= 0) return []
      const normalizedQuantity = addOn.unit_type === 'flat' ? 1 : quantity
      const historicalItem = transaction.add_on_items?.find((item) => item.add_on_id === addOn.id)
      const unitPrice = historicalItem?.unit_price ?? addOn.price
      const itemName = historicalItem?.name ?? addOn.name
      const unitType = historicalItem?.unit_type ?? addOn.unit_type
      return [{
        add_on_id: addOn.id,
        name: itemName,
        unit_type: unitType,
        unit_price: unitPrice,
        quantity: normalizedQuantity,
        line_total: Number((unitPrice * normalizedQuantity).toFixed(2)),
      }]
    })
  }, [addOns, selectedAddOns, transaction.add_on_items])

  const addOnsTotal = useMemo(
    () => selectedAddOnItems.reduce((sum, item) => sum + item.line_total, 0),
    [selectedAddOnItems]
  )

  const isWeightBased =
    selectedService?.pricing_type === 'per_load_by_weight' &&
    selectedService.max_kg_per_load != null &&
    selectedService.max_kg_per_load > 0

  const totalAmount = parseFloat(form.total_amount) || 0
  const cashReceived = parseFloat(form.cash_amount) || 0
  const gcashReceived = parseFloat(form.gcash_amount) || 0
  const isCashPayment = form.payment_method === 'paid'
  const isGcashPayment = form.payment_method === 'gcash'
  const cashEntered = form.cash_amount.trim() !== ''
  const gcashEntered = form.gcash_amount.trim() !== ''
  const cashDifference = isCashPayment && cashEntered ? cashReceived - totalAmount : null
  const changeDue = cashDifference != null && cashDifference > 0 ? cashDifference : 0
  const cashShort = cashDifference != null && cashDifference < 0 ? Math.abs(cashDifference) : 0
  const gcashDifference = isGcashPayment && gcashEntered ? gcashReceived - totalAmount : null

  const recalcFromKg = (kgValue: string, service: typeof selectedService) => {
    if (!service) return { no_of_loads: '', base_amount: '' }
    if (service.pricing_type === 'per_load_by_weight' && service.max_kg_per_load) {
      const kg = parseFloat(kgValue)
      const loads = Number.isFinite(kg) && kg > 0 ? Math.ceil(kg / service.max_kg_per_load) : 0
      const rate = service.default_rate ?? 0
      return {
        no_of_loads: loads > 0 ? String(loads) : '',
        base_amount: loads > 0 ? (loads * rate).toFixed(2) : '',
      }
    }
    return {
      no_of_loads: '',
      base_amount: service.default_rate != null ? String(service.default_rate) : '',
    }
  }

  const recalcTotal = (baseAmount: string, addOnsAmount: string) => {
    const base = parseFloat(baseAmount) || 0
    const addOnAmount = parseFloat(addOnsAmount) || 0
    return (base + addOnAmount).toFixed(2)
  }

  const handleServiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const serviceId = e.target.value
    const nextService = services.find((s) => s.id === serviceId) ?? null
    const nextKg = nextService ? form.kg : ''
    const { no_of_loads, base_amount } = recalcFromKg(nextKg, nextService)
    setForm((f) => ({
      ...f,
      service_id: serviceId,
      kg: nextKg,
      no_of_loads,
      base_amount,
      total_amount: recalcTotal(base_amount, f.add_ons),
    }))
  }

  const handleKgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const kgValue = e.target.value
    const { no_of_loads, base_amount } = recalcFromKg(kgValue, selectedService)
    setForm((f) => ({
      ...f,
      kg: kgValue,
      no_of_loads,
      base_amount,
      total_amount: recalcTotal(base_amount, f.add_ons),
    }))
  }

  const handleBaseAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setForm((f) => ({ ...f, base_amount: value, total_amount: recalcTotal(value, f.add_ons) }))
  }

  const applyAddOnSelection = (next: Record<string, number>) => {
    setSelectedAddOns(next)
    const total = addOns.reduce((sum, addOn) => {
      const quantity = next[addOn.id] ?? 0
      if (quantity <= 0) return sum
      const normalizedQuantity = addOn.unit_type === 'flat' ? 1 : quantity
      const historicalItem = transaction.add_on_items?.find((item) => item.add_on_id === addOn.id)
      const unitPrice = historicalItem?.unit_price ?? addOn.price
      return sum + unitPrice * normalizedQuantity
    }, 0)
    setForm((f) => ({
      ...f,
      add_ons: total.toFixed(2),
      total_amount: recalcTotal(f.base_amount, total.toFixed(2)),
    }))
  }

  const toggleAddOn = (id: string, checked: boolean) => {
    const next = { ...selectedAddOns }
    if (checked) next[id] = 1
    else delete next[id]
    applyAddOnSelection(next)
  }

  const updateAddOnQuantity = (id: string, value: string, isDecimal: boolean) => {
    const parsed = Number(value)
    const quantity = Number.isFinite(parsed) && parsed > 0 ? (isDecimal ? parsed : Math.floor(parsed)) : 1
    applyAddOnSelection({ ...selectedAddOns, [id]: quantity })
  }

  const update = (field: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const handlePaymentMethodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const paymentMethod = e.target.value as PaymentMethod
    setForm((current) => ({
      ...current,
      payment_method: paymentMethod,
      cash_amount: paymentMethod === 'paid' ? current.cash_amount : '',
      gcash_amount: paymentMethod === 'gcash' ? current.gcash_amount : '',
      gcash_reference: paymentMethod === 'gcash' ? current.gcash_reference : '',
    }))
  }

  const updateInventoryUsage = (field: keyof InventoryUsageDraft, value: string) => {
    setInventoryUsage((current) => ({ ...current, [field]: value }))
  }

  const handleSave = async () => {
    if (saveLockRef.current) return
    saveLockRef.current = true

    try {
      setError(null)

      const normalizedCustomerName = toTitleCaseName(form.customer_name)
      if (!normalizedCustomerName) {
        setError('Customer name is required.')
        return
      }
      if (settings.require_phone_number && !form.phone_number.trim()) {
        setError('Phone number is required by the Owner settings.')
        return
      }
      if (!form.service_id) {
        setError('Select a service before entering Kg or saving the transaction.')
        return
      }
      if (isWeightBased && (!form.kg || Number(form.kg) <= 0)) {
        setError('Enter the Kg after selecting the service so Loads and Base Amount can be calculated.')
        return
      }
      if (inventoryError) {
        setError('Inventory items could not be loaded. Refresh the page before saving the transaction.')
        return
      }
      // Legacy orders may legitimately have no inventory fields. Do not make
      // an unrelated edit impossible just because this newer feature was not
      // present when the order was created. If the user starts editing the
      // inventory section, the two sides must still be complete together.
      if (
        transaction.order_status !== 'completed' &&
        inventoryUsageHasAnyValue(inventoryUsage) &&
        !inventoryUsageIsComplete(inventoryUsage)
      ) {
        setError('Complete both inventory usage details. If the customer supplied a product, select Other and enter the reason.')
        return
      }
      if (settings.require_pickup_date && !form.pickup_date) {
        setError('Pickup date is required by the Owner settings.')
        return
      }
      if (settings.require_notes_for_pay_later && form.payment_method === 'pay_later' && !form.notes.trim()) {
        setError('Notes are required for Pay Later transactions by the Owner settings.')
        return
      }

      if (form.payment_method === 'paid') {
        if (!cashEntered) {
          setError('Enter the cash received before saving.')
          return
        }
        if (cashReceived < totalAmount) {
          setError(`Cash received is ${peso(totalAmount - cashReceived)} short.`)
          return
        }
      }

      if (form.payment_method === 'gcash') {
        if (!gcashEntered) {
          setError('Enter the GCash amount received before saving.')
          return
        }
        if (Math.abs(gcashReceived - totalAmount) > 0.005) {
          setError(`GCash received must match the total amount of ${peso(totalAmount)}.`)
          return
        }
        if (!form.gcash_reference.trim()) {
          setError('GCash Transaction # is required for tracking.')
          return
        }
      }

      setSaving(true)

      const detergentCustomerSupplied = inventoryUsage.detergent_item_id === OTHER_INVENTORY_SOURCE
      const conditionerCustomerSupplied = inventoryUsage.fabric_conditioner_item_id === OTHER_INVENTORY_SOURCE
      const shouldPersistInventoryUsage =
        inventoryUsageHasAnyValue(initialInventoryUsage) ||
        !inventoryUsageEquals(inventoryUsage, initialInventoryUsage)
      const shouldPersistAddOnItems = addOnItemsSignature(selectedAddOnItems) !== addOnItemsSignature(transaction.add_on_items)

      const { data: updatedRows, error: updateError } = await supabase
        .from('transactions')
        .update({
          customer_name: normalizedCustomerName,
          phone_number: form.phone_number.trim() || null,
          transaction_date: form.transaction_date,
          service_id: form.service_id,
          kg: form.kg ? Number(form.kg) : null,
          no_of_loads: form.no_of_loads ? Number(form.no_of_loads) : null,
          base_amount: form.base_amount ? Number(form.base_amount) : 0,
          add_ons: addOnsTotal,
          total_amount: form.total_amount ? Number(form.total_amount) : 0,
          cash_amount: form.cash_amount ? Number(form.cash_amount) : 0,
          gcash_amount: form.gcash_amount ? Number(form.gcash_amount) : 0,
          gcash_reference: form.payment_method === 'gcash' ? form.gcash_reference.trim() : null,
          payment_method: form.payment_method,
          pickup_date: form.pickup_date || null,
          pickup_time: form.pickup_date && form.pickup_time ? form.pickup_time : null,
          notes: form.notes.trim() || null,
          ...(shouldPersistInventoryUsage ? {
            detergent_source: detergentCustomerSupplied ? 'customer_supplied' : 'inventory',
            detergent_item_id: detergentCustomerSupplied ? null : inventoryUsage.detergent_item_id || null,
            detergent_quantity: detergentCustomerSupplied ? null : inventoryUsage.detergent_quantity ? Number(inventoryUsage.detergent_quantity) : null,
            detergent_other_reason: detergentCustomerSupplied ? inventoryUsage.detergent_other_reason.trim() : null,
            fabric_conditioner_source: conditionerCustomerSupplied ? 'customer_supplied' : 'inventory',
            fabric_conditioner_item_id: conditionerCustomerSupplied ? null : inventoryUsage.fabric_conditioner_item_id || null,
            fabric_conditioner_quantity: conditionerCustomerSupplied ? null : inventoryUsage.fabric_conditioner_quantity ? Number(inventoryUsage.fabric_conditioner_quantity) : null,
            fabric_conditioner_other_reason: conditionerCustomerSupplied ? inventoryUsage.fabric_conditioner_other_reason.trim() : null,
          } : {}),
          ...(shouldPersistAddOnItems ? { add_on_items: selectedAddOnItems } : {}),
        })
        .eq('id', transaction.id)
        .eq('updated_at', transaction.updated_at)
        .select('id, updated_at')

      setSaving(false)

      if (updateError) {
        const lower = updateError.message.toLowerCase()
        if (lower.includes('transactions_gcash_reference_unique_idx')) {
          setError('That GCash Transaction # is already attached to another transaction.')
        } else if (lower.includes('staff transaction editing is disabled')) {
          setError('Transaction editing is currently disabled for Staff by the Owner.')
        } else {
          setError(updateError.message)
        }
        return
      }

      if (!updatedRows || updatedRows.length === 0) {
        setError('This transaction was updated or deleted by another user after you opened it. Close this editor, refresh/reopen the transaction, and review the latest version before saving.')
        return
      }

      onClose()
    } finally {
      setSaving(false)
      saveLockRef.current = false
    }
  }

  const inputClass =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'
  const autoInputClass = `${inputClass} bg-slate-50 text-slate-700 cursor-not-allowed dark:bg-slate-800 dark:text-slate-300`
  const labelClass = 'block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 space-y-5 dark:bg-slate-900 border border-slate-200 dark:border-slate-800" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">Edit Transaction — {transaction.transaction_code || `#${String(transaction.transaction_no).padStart(4, '0')}`}</h2>
            <p className="text-xs text-slate-500 mt-0.5">Changes apply immediately and are logged under Last Updated By.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl leading-none px-1">×</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Customer Name *</label>
            <input required value={form.customer_name} onChange={update('customer_name')} onBlur={() => setForm((f) => ({ ...f, customer_name: toTitleCaseName(f.customer_name) }))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Phone Number{settings.require_phone_number ? ' *' : ''}</label>
            <input required={settings.require_phone_number} value={form.phone_number} onChange={update('phone_number')} className={inputClass} placeholder="09xxxxxxxxx" />
          </div>

          <div>
            <label className={labelClass}>Transaction Date *</label>
            <input type="date" required value={form.transaction_date} onChange={update('transaction_date')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Service *</label>
            <select required value={form.service_id} onChange={handleServiceChange} className={inputClass}>
              <option value="">Select service…</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.code})</option>)}
            </select>
          </div>

          <div>
            <label className={labelClass}>Kg{isWeightBased ? ' *' : ''}</label>
            <input type="number" step="0.1" min={isWeightBased ? '0.1' : '0'} required={Boolean(form.service_id) && isWeightBased} disabled={!form.service_id} value={form.kg} onChange={handleKgChange} placeholder={!form.service_id ? 'Select service first' : undefined} className={`${inputClass} disabled:opacity-50 disabled:cursor-not-allowed`} />
            {!form.service_id && <p className="mt-1 text-xs text-slate-500">Select a service first to enable Kg.</p>}
          </div>
          <div>
            <label className={labelClass}>No. of Loads{isWeightBased ? ' · Auto' : ''}</label>
            <input type="number" min="0" disabled={!form.service_id} value={form.no_of_loads} onChange={isWeightBased || !form.service_id ? undefined : update('no_of_loads')} readOnly={isWeightBased || !form.service_id} className={isWeightBased || !form.service_id ? `${autoInputClass} disabled:opacity-50` : inputClass} />
          </div>

          <div>
            <label className={labelClass}>Base Amount (₱){isWeightBased ? ' · Auto' : ''}</label>
            <input type="number" step="0.01" min="0" disabled={!form.service_id} value={form.base_amount} onChange={isWeightBased || !form.service_id ? undefined : handleBaseAmountChange} readOnly={isWeightBased || !form.service_id} className={isWeightBased || !form.service_id ? `${autoInputClass} disabled:opacity-50` : inputClass} />
          </div>
          <div>
            <label className={labelClass}>Add-ons Total (₱) · Auto</label>
            <input type="number" value={form.add_ons} readOnly className={autoInputClass} />
          </div>
        </div>

        <InventoryUsageFields
          usage={inventoryUsage}
          detergentItems={detergentItems}
          fabricConditionerItems={fabricConditionerItems}
          loading={inventoryLoading}
          disabled={transaction.order_status === 'completed'}
          onChange={updateInventoryUsage}
        />

        <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Add-ons</h3>
              <p className="text-xs text-slate-500">Existing add-ons keep their historical unit price even if the catalog price changed later.</p>
            </div>
            {selectedAddOnItems.length > 0 && <span className="text-sm font-semibold text-sky-600">{peso(addOnsTotal)}</span>}
          </div>

          {addOnsLoading ? (
            <LoadingPanel compact label="Loading add-ons…" slowLabel="Still loading add-ons…" />
          ) : addOns.length === 0 ? (
            <p className="text-sm text-slate-400 py-3">No add-ons configured yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {addOns.map((addOn) => {
                const selected = (selectedAddOns[addOn.id] ?? 0) > 0
                const quantity = selectedAddOns[addOn.id] ?? 1
                const effectiveQuantity = addOn.unit_type === 'flat' ? 1 : quantity
                const historicalItem = transaction.add_on_items?.find((item) => item.add_on_id === addOn.id)
                const displayPrice = historicalItem?.unit_price ?? addOn.price
                const lineTotal = displayPrice * effectiveQuantity
                const decimalQuantity = addOn.unit_type === 'kg'

                return (
                  <div key={addOn.id} className={`rounded-lg border p-3 ${selected ? 'border-sky-300 bg-sky-50/60 dark:border-sky-800 dark:bg-sky-950/20' : 'border-slate-200 dark:border-slate-700'}`}>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" checked={selected} onChange={(e) => toggleAddOn(addOn.id, e.target.checked)} className="mt-1 h-4 w-4" />
                      <span className="flex-1">
                        <span className="flex items-center justify-between gap-3">
                          <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{historicalItem?.name ?? addOn.name}{!addOn.active && <span className="text-slate-400"> (inactive)</span>}</span>
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{peso(displayPrice)} / {historicalItem?.unit_type ?? addOn.unit_type}</span>
                        </span>
                        {selected && (
                          <span className="mt-3 flex items-end justify-between gap-3">
                            <span className="w-28">
                              <span className="block text-xs text-slate-500 mb-1">Quantity</span>
                              <input type="number" min={decimalQuantity ? '0.1' : '1'} step={decimalQuantity ? '0.1' : '1'} disabled={(historicalItem?.unit_type ?? addOn.unit_type) === 'flat'} value={effectiveQuantity} onChange={(e) => updateAddOnQuantity(addOn.id, e.target.value, decimalQuantity)} onClick={(e) => e.stopPropagation()} className={`${inputClass} py-1.5 disabled:opacity-60`} />
                            </span>
                            <span className="text-right">
                              <span className="block text-xs text-slate-500">{effectiveQuantity} {unitLabel(historicalItem?.unit_type ?? addOn.unit_type, effectiveQuantity)}</span>
                              <strong className="text-sm text-slate-900 dark:text-slate-100">{peso(lineTotal)}</strong>
                            </span>
                          </span>
                        )}
                      </span>
                    </label>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Total (₱){settings.allow_manual_total_override ? '' : ' · Auto'}</label>
            <input type="number" step="0.01" min="0" value={form.total_amount} readOnly={!settings.allow_manual_total_override} onChange={settings.allow_manual_total_override ? update('total_amount') : undefined} className={settings.allow_manual_total_override ? inputClass : autoInputClass} />
            {!settings.allow_manual_total_override && <p className="mt-1 text-xs text-slate-500">Manual Total override is disabled by the Owner.</p>}
          </div>
          <div>
            <label className={labelClass}>Payment Method *</label>
            <select required value={form.payment_method} onChange={handlePaymentMethodChange} className={inputClass}>
              <option value="paid">Cash</option><option value="gcash">GCash</option><option value="pay_later">Pay Later</option>
            </select>
          </div>

          <div>
            <label className={labelClass}>Cash Received (₱){isCashPayment ? ' *' : ''}</label>
            <input type="number" step="0.01" min="0" disabled={!isCashPayment} value={form.cash_amount} onChange={update('cash_amount')} className={`${inputClass} disabled:opacity-50 disabled:cursor-not-allowed`} />
            {isCashPayment && cashEntered && cashShort > 0 && <p className="mt-1 text-xs font-medium text-red-600">Short by {peso(cashShort)}.</p>}
            {isCashPayment && cashEntered && changeDue > 0 && <p className="mt-1 text-xs font-medium text-amber-700">Change due: {peso(changeDue)}</p>}
          </div>

          <div>
            <label className={labelClass}>GCash Received (₱){isGcashPayment ? ' *' : ''}</label>
            <input type="number" step="0.01" min="0" disabled={!isGcashPayment} value={form.gcash_amount} onChange={update('gcash_amount')} className={`${inputClass} disabled:opacity-50 disabled:cursor-not-allowed`} />
            {isGcashPayment && gcashEntered && gcashDifference !== 0 && <p className="mt-1 text-xs font-medium text-red-600">Must match {peso(totalAmount)}.</p>}
          </div>

          {isGcashPayment && (
            <div className="sm:col-span-2">
              <label className={labelClass}>GCash Transaction # *</label>
              <input required value={form.gcash_reference} onChange={update('gcash_reference')} className={inputClass} autoComplete="off" />
            </div>
          )}

          <div>
            <label className={labelClass}>Pickup Date{settings.require_pickup_date ? ' *' : ''}</label>
            <div className="flex gap-2">
              <input type="date" required={settings.require_pickup_date} value={form.pickup_date} onChange={(e) => setForm((f) => ({ ...f, pickup_date: e.target.value, pickup_time: e.target.value ? f.pickup_time : '' }))} className={`${inputClass} flex-1`} />
              <input type="time" value={form.pickup_time} onChange={update('pickup_time')} disabled={!form.pickup_date} className={`${inputClass} w-32 disabled:opacity-50 disabled:cursor-not-allowed`} />
            </div>
          </div>
          <div>
            <label className={labelClass}>Notes{settings.require_notes_for_pay_later && form.payment_method === 'pay_later' ? ' *' : ''}</label>
            <input required={settings.require_notes_for_pay_later && form.payment_method === 'pay_later'} value={form.notes} onChange={update('notes')} className={inputClass} />
          </div>
        </div>

        {error && <InlineAlert variant="error" title="Changes were not saved">{error}</InlineAlert>}

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
          <button type="button" onClick={() => void handleSave()} disabled={saving || inventoryLoading} className="inline-flex items-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-medium rounded-lg px-4 py-2 text-sm transition">
            {saving && <ButtonSpinner />}{saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
