import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useServices } from '../hooks/useServices'
import { useAddOns } from '../hooks/useAddOns'
import { useDiscountPromos } from '../hooks/useDiscountPromos'
import { useCustomers } from '../hooks/useCustomers'
import { useAuth } from '../lib/auth-context'
import { useShopSettings } from '../lib/shop-settings-context'
import type { DiscountPromo, PaymentMethod, TransactionAddOnItem } from '../types/database'
import { shopDate } from '../lib/date'
import { toTitleCaseName } from '../lib/text'
import { ButtonSpinner, InlineAlert, LoadingPanel } from './UiFeedback'
import InventoryUsageFields from './InventoryUsageFields'
import {
  emptyInventoryUsageDraft,
  OTHER_INVENTORY_SOURCE,
  inventoryUsageIsComplete,
  useInventoryConsumables,
  type InventoryUsageDraft,
} from '../hooks/useInventoryConsumables'

const makeEmptyForm = (defaultPaymentMethod: PaymentMethod) => ({
  customer_name: '',
  phone_number: '',
  customer_id: '',
  transaction_date: shopDate(),
  service_id: '',
  kg: '',
  no_of_loads: '',
  base_amount: '',
  add_ons: '0',
  total_amount: '',
  cash_amount: '',
  gcash_amount: '',
  gcash_reference: '',
  payment_method: defaultPaymentMethod,
  pickup_date: '',
  pickup_time: '',
  notes: '',
})

type TransactionFormState = ReturnType<typeof makeEmptyForm>

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const unitLabel = (unit: string, quantity = 1) => {
  if (unit === 'flat') return 'flat'
  if (unit === 'ml') return 'ml'
  return quantity === 1 ? unit : `${unit}s`
}

export default function TransactionForm({ onAdded }: { onAdded?: () => void }) {
  const { services, loading: servicesLoading, error: servicesError } = useServices()
  const { addOns, loading: addOnsLoading, error: addOnsError } = useAddOns()
  const { promos: discountPromos, loading: discountPromosLoading, error: discountPromosError, realtimeState: discountRealtimeState } = useDiscountPromos()
  const { rows: customers, loading: customersLoading, error: customersError } = useCustomers()
  const { profile } = useAuth()
  const { settings } = useShopSettings()
  const { detergentItems, fabricConditionerItems, loading: inventoryLoading, error: inventoryError } = useInventoryConsumables()
  const isOwner = profile?.role === 'owner'
  const canCreate = isOwner || settings.staff_can_create_transactions

  const [form, setForm] = useState<TransactionFormState>(() => makeEmptyForm(settings.default_payment_method))
  const [selectedAddOns, setSelectedAddOns] = useState<Record<string, number>>({})
  const [selectedPromoId, setSelectedPromoId] = useState('')
  const [inventoryUsage, setInventoryUsage] = useState<InventoryUsageDraft>(() => emptyInventoryUsageDraft())
  const [totalTouched, setTotalTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [clientRequestId, setClientRequestId] = useState(() => crypto.randomUUID())
  const submitLockRef = useRef(false)

  const selectedService = useMemo(
    () => services.find((service) => service.id === form.service_id) ?? null,
    [form.service_id, services]
  )

  const selectedAddOnItems = useMemo<TransactionAddOnItem[]>(() => {
    return addOns.flatMap((addOn) => {
      const quantity = selectedAddOns[addOn.id] ?? 0
      if (quantity <= 0) return []
      const normalizedQuantity = addOn.unit_type === 'flat' ? 1 : quantity
      return [
        {
          add_on_id: addOn.id,
          name: addOn.name,
          unit_type: addOn.unit_type,
          unit_price: addOn.price,
          quantity: normalizedQuantity,
          line_total: Number((addOn.price * normalizedQuantity).toFixed(2)),
        },
      ]
    })
  }, [addOns, selectedAddOns])

  const addOnsTotal = useMemo(
    () => selectedAddOnItems.reduce((sum, item) => sum + item.line_total, 0),
    [selectedAddOnItems]
  )

  const applicablePromos = useMemo(() => {
    const now = Date.now()
    return discountPromos.filter((promo) => {
      if (!promo.active || now < new Date(promo.starts_at).getTime() || now > new Date(promo.ends_at).getTime()) return false
      if (promo.applies_to === 'service') return promo.service_id === form.service_id
      if (promo.applies_to === 'add_on') return selectedAddOnItems.some((item) => item.add_on_id === promo.add_on_id)
      return true
    })
  }, [discountPromos, form.service_id, selectedAddOnItems])

  const selectedPromo = useMemo<DiscountPromo | null>(
    () => applicablePromos.find((promo) => promo.id === selectedPromoId) ?? null,
    [applicablePromos, selectedPromoId]
  )

  const subtotal = (parseFloat(form.base_amount) || 0) + addOnsTotal
  const discountAmount = useMemo(() => {
    if (!selectedPromo) return 0
    if (selectedPromo.discount_type === 'percentage') {
      return Math.min(subtotal, Number((subtotal * selectedPromo.discount_value / 100).toFixed(2)))
    }
    return Math.min(subtotal, selectedPromo.discount_value)
  }, [selectedPromo, subtotal])

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

  useEffect(() => {
    if (!selectedService) {
      setForm((f) => ({ ...f, no_of_loads: '', base_amount: '' }))
      setTotalTouched(false)
      return
    }

    if (isWeightBased) {
      const kg = parseFloat(form.kg)
      const loads = Number.isFinite(kg) && kg > 0 ? Math.ceil(kg / selectedService.max_kg_per_load!) : 0
      const rate = selectedService.default_rate ?? 0

      setForm((f) => ({
        ...f,
        no_of_loads: loads > 0 ? String(loads) : '',
        base_amount: loads > 0 ? (loads * rate).toFixed(2) : '',
      }))
      setTotalTouched(false)
      return
    }

    setForm((f) => ({
      ...f,
      no_of_loads: '',
      base_amount: selectedService.default_rate != null ? String(selectedService.default_rate) : '',
    }))
    setTotalTouched(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.service_id, selectedService?.id, isWeightBased])

  useEffect(() => {
    if (!isWeightBased || !selectedService?.max_kg_per_load) return

    const kg = parseFloat(form.kg)
    const loads = Number.isFinite(kg) && kg > 0 ? Math.ceil(kg / selectedService.max_kg_per_load) : 0
    const rate = selectedService.default_rate ?? 0

    setForm((f) => ({
      ...f,
      no_of_loads: loads > 0 ? String(loads) : '',
      base_amount: loads > 0 ? (loads * rate).toFixed(2) : '',
    }))
    setTotalTouched(false)
  }, [form.kg, isWeightBased, selectedService?.default_rate, selectedService?.max_kg_per_load])

  useEffect(() => {
    setForm((f) => ({ ...f, add_ons: addOnsTotal.toFixed(2) }))
    setTotalTouched(false)
  }, [addOnsTotal])

  useEffect(() => {
    if (totalTouched && settings.allow_manual_total_override) return
    const base = parseFloat(form.base_amount) || 0
    const addOnAmount = parseFloat(form.add_ons) || 0
    setForm((f) => ({ ...f, total_amount: Math.max(0, base + addOnAmount - discountAmount).toFixed(2) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.base_amount, form.add_ons, discountAmount, totalTouched, settings.allow_manual_total_override])

  useEffect(() => {
    if (selectedPromoId && !selectedPromo) setSelectedPromoId('')
  }, [selectedPromo, selectedPromoId])

  useEffect(() => {
    if (!settings.allow_manual_total_override) setTotalTouched(false)
  }, [settings.allow_manual_total_override])

  useEffect(() => {
    setForm((f) => {
      if (f.payment_method === 'paid' && (f.gcash_amount !== '' || f.gcash_reference !== '')) {
        return { ...f, gcash_amount: '', gcash_reference: '' }
      }
      if (f.payment_method === 'gcash' && f.cash_amount !== '') {
        return { ...f, cash_amount: '' }
      }
      if (
        f.payment_method === 'pay_later' &&
        (f.cash_amount !== '' || f.gcash_amount !== '' || f.gcash_reference !== '')
      ) {
        return { ...f, cash_amount: '', gcash_amount: '', gcash_reference: '' }
      }
      return f
    })
  }, [form.payment_method])

  const update = (field: keyof TransactionFormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const handleServiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const serviceId = e.target.value
    setForm((f) =>
      serviceId
        ? { ...f, service_id: serviceId }
        : { ...f, service_id: '', kg: '', no_of_loads: '', base_amount: '' }
    )
    setTotalTouched(false)
  }

  const toggleAddOn = (id: string, checked: boolean) => {
    setSelectedAddOns((current) => {
      if (checked) return { ...current, [id]: 1 }
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  const updateAddOnQuantity = (id: string, value: string, isDecimal: boolean) => {
    const parsed = Number(value)
    const quantity = Number.isFinite(parsed) && parsed > 0 ? (isDecimal ? parsed : Math.floor(parsed)) : 1
    setSelectedAddOns((current) => ({ ...current, [id]: quantity }))
  }

  const resetForm = () => {
    setForm(makeEmptyForm(settings.default_payment_method))
    setSelectedAddOns({})
    setSelectedPromoId('')
    setInventoryUsage(emptyInventoryUsageDraft())
    setTotalTouched(false)
    setClientRequestId(crypto.randomUUID())
  }

  const updateInventoryUsage = (field: keyof InventoryUsageDraft, value: string) => {
    setInventoryUsage((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canCreate || submitLockRef.current) return
    submitLockRef.current = true

    try {
      setError(null)
      setSuccess(null)

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
        setError('Select a service before entering Kg and saving the transaction.')
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
      if (!inventoryUsageIsComplete(inventoryUsage)) {
        setError('Complete both inventory usage details. If the customer supplied a product, select Other and enter the reason.')
        return
      }
      if (selectedPromoId && !selectedPromo) {
        setError('That discount or promo is no longer active. Please choose another offer.')
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
          setError('Enter the cash received before saving the transaction.')
          return
        }
        if (cashReceived < totalAmount) {
          setError(`Cash received is ${peso(totalAmount - cashReceived)} short.`)
          return
        }
      }

      if (form.payment_method === 'gcash') {
        if (!gcashEntered) {
          setError('Enter the GCash amount received before saving the transaction.')
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

      setSubmitting(true)

      const detergentCustomerSupplied = inventoryUsage.detergent_item_id === OTHER_INVENTORY_SOURCE
      const conditionerCustomerSupplied = inventoryUsage.fabric_conditioner_item_id === OTHER_INVENTORY_SOURCE

      const { error: insertError } = await supabase.from('transactions').insert({
        customer_id: form.customer_id || null,
        customer_name: normalizedCustomerName,
        phone_number: form.phone_number.trim() || null,
        transaction_date: form.transaction_date,
        service_id: form.service_id,
        detergent_source: detergentCustomerSupplied ? 'customer_supplied' : 'inventory',
        detergent_item_id: detergentCustomerSupplied ? null : inventoryUsage.detergent_item_id,
        detergent_quantity: detergentCustomerSupplied ? null : Number(inventoryUsage.detergent_quantity),
        detergent_other_reason: detergentCustomerSupplied ? inventoryUsage.detergent_other_reason.trim() : null,
        fabric_conditioner_source: conditionerCustomerSupplied ? 'customer_supplied' : 'inventory',
        fabric_conditioner_item_id: conditionerCustomerSupplied ? null : inventoryUsage.fabric_conditioner_item_id,
        fabric_conditioner_quantity: conditionerCustomerSupplied ? null : Number(inventoryUsage.fabric_conditioner_quantity),
        fabric_conditioner_other_reason: conditionerCustomerSupplied ? inventoryUsage.fabric_conditioner_other_reason.trim() : null,
        kg: form.kg ? Number(form.kg) : null,
        no_of_loads: form.no_of_loads ? Number(form.no_of_loads) : null,
        base_amount: form.base_amount ? Number(form.base_amount) : 0,
        add_ons: addOnsTotal,
        add_on_items: selectedAddOnItems,
        discount_promo_id: selectedPromo?.id ?? null,
        discount_promo_name_snapshot: selectedPromo?.name ?? null,
        discount_promo_kind_snapshot: selectedPromo?.kind ?? null,
        discount_type_snapshot: selectedPromo?.discount_type ?? null,
        discount_value_snapshot: selectedPromo?.discount_value ?? null,
        discount_amount: discountAmount,
        total_amount: form.total_amount ? Number(form.total_amount) : 0,
        cash_amount: form.cash_amount ? Number(form.cash_amount) : 0,
        gcash_amount: form.gcash_amount ? Number(form.gcash_amount) : 0,
        gcash_reference: form.payment_method === 'gcash' ? form.gcash_reference.trim() : null,
        payment_method: form.payment_method,
        pickup_date: form.pickup_date || null,
        pickup_time: form.pickup_date && form.pickup_time ? form.pickup_time : null,
        notes: form.notes.trim() || null,
        created_by: profile?.id ?? null,
        client_request_id: clientRequestId,
      })

      setSubmitting(false)

      if (insertError) {
        const lower = insertError.message.toLowerCase()
        if (lower.includes('transactions_gcash_reference_unique_idx')) {
          setError('That GCash Transaction # is already attached to another transaction.')
        } else if (lower.includes('transactions_client_request_id_unique_idx')) {
          setSuccess(`Added — ${normalizedCustomerName} (duplicate click ignored)`)
          resetForm()
          onAdded?.()
          setTimeout(() => setSuccess(null), 4000)
        } else if (lower.includes('staff transaction creation') || lower.includes('row-level security')) {
          setError('Transaction creation is currently disabled for Staff by the Owner.')
        } else {
          setError(insertError.message)
        }
        return
      }

      const changeMessage = form.payment_method === 'paid' && changeDue > 0 ? ` · Change ${peso(changeDue)}` : ''
      const gcashMessage = form.payment_method === 'gcash' ? ` · GCash #${form.gcash_reference.trim()}` : ''
      const addOnMessage = selectedAddOnItems.length > 0 ? ` · Add-ons ${peso(addOnsTotal)}` : ''
      const discountMessage = discountAmount > 0 && selectedPromo ? ` · ${selectedPromo.name} -${peso(discountAmount)}` : ''
      setSuccess(`Added — ${normalizedCustomerName}${addOnMessage}${discountMessage}${changeMessage}${gcashMessage}`)
      resetForm()
      onAdded?.()
      setTimeout(() => setSuccess(null), 4000)
    } finally {
      setSubmitting(false)
      submitLockRef.current = false
    }
  }

  const inputClass =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'
  const autoInputClass = `${inputClass} bg-slate-50 text-slate-700 cursor-not-allowed dark:bg-slate-800 dark:text-slate-300`
  const labelClass = 'block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400'

  if (!canCreate) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <InlineAlert variant="info" title="Transaction entry is disabled for Staff">
          The Owner has turned off Staff transaction creation. You can still review the records you are allowed to access below.
        </InlineAlert>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5 dark:bg-slate-900 dark:border-slate-800">
      <h2 className="font-semibold text-slate-900 dark:text-slate-100">Add Customer Transaction</h2>

      {(servicesError || addOnsError || customersError || discountPromosError) && (
        <InlineAlert variant="warning" title="Some catalog data could not be refreshed">
          {servicesError || addOnsError || customersError || discountPromosError}. Existing loaded options remain available where possible.
        </InlineAlert>
      )}
      {!discountPromosError && (discountRealtimeState === 'disconnected' || discountRealtimeState === 'error') && (
        <InlineAlert variant="warning" title="Live discount sync is temporarily offline">
          New Owner changes may need a manual refresh until Realtime reconnects.
        </InlineAlert>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className={labelClass}>Existing Customer (optional)</label>
          <select
            value={form.customer_id}
            onChange={(e) => {
              const customer = customers.find((row) => row.id === e.target.value)
              setForm((current) => ({
                ...current,
                customer_id: customer?.id ?? '',
                customer_name: customer?.full_name ?? current.customer_name,
                phone_number: customer?.phone_number ?? current.phone_number,
              }))
            }}
            disabled={customersLoading}
            className={`${inputClass} disabled:opacity-60`}
          >
            <option value="">{customersLoading ? 'Loading customers…' : 'Walk-In / New Customer'}</option>
            {customers.filter((customer) => customer.active).map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.customer_code} · {customer.full_name}{customer.phone_number ? ` · ${customer.phone_number}` : ''}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">Selecting a customer links this order while preserving the name and phone snapshots on the transaction.</p>
        </div>
        <div>
          <label className={labelClass}>Customer Name *</label>
          <input required value={form.customer_name} onChange={(e) => setForm((current) => ({ ...current, customer_id: '', customer_name: e.target.value }))} onBlur={() => setForm((f) => ({ ...f, customer_name: toTitleCaseName(f.customer_name) }))} className={inputClass} placeholder="Earl Dela Cruz" />
        </div>
        <div>
          <label className={labelClass}>Phone Number{settings.require_phone_number ? ' *' : ''}</label>
          <input required={settings.require_phone_number} value={form.phone_number} onChange={(e) => setForm((current) => ({ ...current, customer_id: '', phone_number: e.target.value }))} className={inputClass} placeholder="09xxxxxxxxx" />
        </div>

        <div>
          <label className={labelClass}>Transaction Date *</label>
          <input type="date" required value={form.transaction_date} onChange={update('transaction_date')} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Service *</label>
          <select required disabled={servicesLoading} value={form.service_id} onChange={handleServiceChange} className={`${inputClass} disabled:opacity-60`}>
            <option value="">{servicesLoading ? 'Loading services…' : 'Select service…'}</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.code})</option>)}
          </select>
        </div>

        <div>
          <label className={labelClass}>Kg{isWeightBased ? ' *' : ''}</label>
          <input type="number" step="0.1" min={isWeightBased ? '0.1' : '0'} required={Boolean(form.service_id) && isWeightBased} disabled={!form.service_id} value={form.kg} onChange={update('kg')} placeholder={!form.service_id ? 'Select service first' : undefined} className={`${inputClass} disabled:opacity-50 disabled:cursor-not-allowed`} />
          {!form.service_id && <p className="mt-1 text-xs text-slate-500">Select a service first to enable Kg.</p>}
          {isWeightBased && selectedService?.max_kg_per_load && <p className="mt-1 text-xs text-sky-700 dark:text-sky-400">Auto rule: up to {selectedService.max_kg_per_load} kg per load</p>}
        </div>
        <div>
          <label className={labelClass}>No. of Loads{isWeightBased ? ' · Auto' : ''}</label>
          <input type="number" min="0" disabled={!form.service_id} value={form.no_of_loads} onChange={isWeightBased || !form.service_id ? undefined : update('no_of_loads')} readOnly={isWeightBased || !form.service_id} placeholder={!form.service_id ? 'Select service first' : isWeightBased ? 'Enter kg first' : undefined} className={isWeightBased || !form.service_id ? `${autoInputClass} disabled:opacity-50` : inputClass} />
          {isWeightBased && form.no_of_loads && <p className="mt-1 text-xs text-slate-500">{form.kg} kg = {form.no_of_loads} load{form.no_of_loads === '1' ? '' : 's'}, same transaction #</p>}
        </div>

        <div>
          <label className={labelClass}>Base Amount (₱){isWeightBased ? ' · Auto' : ''}</label>
          <input type="number" step="0.01" min="0" disabled={!form.service_id} value={form.base_amount} onChange={isWeightBased || !form.service_id ? undefined : update('base_amount')} readOnly={isWeightBased || !form.service_id} placeholder={!form.service_id ? 'Select service first' : undefined} className={isWeightBased || !form.service_id ? `${autoInputClass} disabled:opacity-50` : inputClass} />
          {isWeightBased && form.no_of_loads && selectedService?.default_rate != null && <p className="mt-1 text-xs text-slate-500">₱{selectedService.default_rate.toFixed(2)} × {form.no_of_loads} load{form.no_of_loads === '1' ? '' : 's'}</p>}
        </div>
        <div>
          <label className={labelClass}>Add-ons Total (₱) · Auto</label>
          <input type="number" value={form.add_ons} readOnly className={autoInputClass} />
          <p className="mt-1 text-xs text-slate-500">Select add-ons below. Prices and quantities are tracked with the transaction.</p>
        </div>
      </div>

      <InventoryUsageFields
        usage={inventoryUsage}
        detergentItems={detergentItems}
        fabricConditionerItems={fabricConditionerItems}
        loading={inventoryLoading}
        onChange={updateInventoryUsage}
      />

      <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Add-ons</h3>
            <p className="text-xs text-slate-500">Optional. Check an item and enter the quantity used.</p>
          </div>
          {selectedAddOnItems.length > 0 && <span className="text-sm font-semibold text-sky-600">{peso(addOnsTotal)}</span>}
        </div>

        {addOnsLoading ? (
          <LoadingPanel compact label="Loading add-ons…" slowLabel="Still loading add-ons…" />
        ) : addOns.length === 0 ? (
          <p className="text-sm text-slate-400 py-3">No active add-ons configured yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {addOns.map((addOn) => {
              const selected = (selectedAddOns[addOn.id] ?? 0) > 0
              const quantity = selectedAddOns[addOn.id] ?? 1
              const effectiveQuantity = addOn.unit_type === 'flat' ? 1 : quantity
              const lineTotal = addOn.price * effectiveQuantity
              const decimalQuantity = addOn.unit_type === 'kg'

              return (
                <div key={addOn.id} className={`rounded-lg border p-3 ${selected ? 'border-sky-300 bg-sky-50/60 dark:border-sky-800 dark:bg-sky-950/20' : 'border-slate-200 dark:border-slate-700'}`}>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={selected} onChange={(e) => toggleAddOn(addOn.id, e.target.checked)} className="mt-1 h-4 w-4" />
                    <span className="flex-1">
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{addOn.name}</span>
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{peso(addOn.price)} / {addOn.unit_type}</span>
                      </span>
                      {selected && (
                        <span className="mt-3 flex items-end justify-between gap-3">
                          <span className="w-28">
                            <span className="block text-xs text-slate-500 mb-1">Quantity</span>
                            <input type="number" min={decimalQuantity ? '0.1' : '1'} step={decimalQuantity ? '0.1' : '1'} disabled={addOn.unit_type === 'flat'} value={effectiveQuantity} onChange={(e) => updateAddOnQuantity(addOn.id, e.target.value, decimalQuantity)} onClick={(e) => e.stopPropagation()} className={`${inputClass} py-1.5 disabled:opacity-60`} />
                          </span>
                          <span className="text-right">
                            <span className="block text-xs text-slate-500">{effectiveQuantity} {unitLabel(addOn.unit_type, effectiveQuantity)}</span>
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

      <section className="rounded-xl border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-900/60 dark:bg-violet-950/20">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Discount / Promo</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">Optional. Staff selects one offer for this order. Only live and applicable offers appear here.</p>
          </div>
          {discountAmount > 0 && <span className="text-sm font-semibold text-emerald-600">-{peso(discountAmount)}</span>}
        </div>
        <select value={selectedPromoId} onChange={(e) => setSelectedPromoId(e.target.value)} disabled={discountPromosLoading} className={inputClass + ' disabled:opacity-60'}>
          <option value="">{discountPromosLoading ? 'Loading discounts and promos…' : 'No discount / promo'}</option>
          {applicablePromos.map((promo) => (
            <option key={promo.id} value={promo.id}>
              {promo.name} · {promo.discount_type === 'percentage' ? promo.discount_value + '% off' : peso(promo.discount_value) + ' off'} · until {new Date(promo.ends_at).toLocaleDateString('en-PH')}
            </option>
          ))}
        </select>
        {selectedPromo && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">Applied: {selectedPromo.name} · Total discount {peso(discountAmount)}. The offer details will be saved with this transaction.</p>}
        {!discountPromosLoading && applicablePromos.length === 0 && <p className="mt-2 text-xs text-slate-500">No live applicable discount or promo right now.</p>}
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Total (₱){settings.allow_manual_total_override ? '' : ' · Auto'}</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.total_amount}
            readOnly={!settings.allow_manual_total_override}
            onChange={settings.allow_manual_total_override ? (e) => {
              setTotalTouched(true)
              setForm((f) => ({ ...f, total_amount: e.target.value }))
            } : undefined}
            className={settings.allow_manual_total_override ? inputClass : autoInputClass}
          />
          {!settings.allow_manual_total_override && <p className="mt-1 text-xs text-slate-500">Locked by Owner settings: Base Amount + Add-ons - Discount / Promo.</p>}
        </div>
        <div>
          <label className={labelClass}>Payment Method *</label>
          <select required value={form.payment_method} onChange={update('payment_method')} className={inputClass}>
            <option value="paid">Cash</option><option value="gcash">GCash</option><option value="pay_later">Pay Later</option>
          </select>
        </div>

        <div>
          <label className={labelClass}>Cash Received (₱){isCashPayment ? ' *' : ''}</label>
          <input type="number" step="0.01" min="0" required={isCashPayment} disabled={!isCashPayment} value={form.cash_amount} onChange={update('cash_amount')} className={`${inputClass} disabled:opacity-50 disabled:cursor-not-allowed`} placeholder={isCashPayment ? 'Amount tendered by customer' : 'Select Cash payment'} />
          {isCashPayment && cashEntered && cashShort > 0 && <p className="mt-1 text-xs font-medium text-red-600">Short by {peso(cashShort)}. Transaction cannot be saved.</p>}
          {isCashPayment && cashEntered && cashDifference === 0 && <p className="mt-1 text-xs font-medium text-emerald-600">Exact payment. No change due.</p>}
          {isCashPayment && cashEntered && changeDue > 0 && <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">Change due: <strong>{peso(changeDue)}</strong></div>}
        </div>

        <div>
          <label className={labelClass}>GCash Received (₱){isGcashPayment ? ' *' : ''}</label>
          <input type="number" step="0.01" min="0" required={isGcashPayment} disabled={!isGcashPayment} value={form.gcash_amount} onChange={update('gcash_amount')} className={`${inputClass} disabled:opacity-50 disabled:cursor-not-allowed`} placeholder={isGcashPayment ? 'GCash amount received' : 'Select GCash payment'} />
          {isGcashPayment && gcashEntered && gcashDifference === 0 && <p className="mt-1 text-xs font-medium text-emerald-600">GCash amount matches the total.</p>}
          {isGcashPayment && gcashEntered && gcashDifference !== 0 && <p className="mt-1 text-xs font-medium text-red-600">GCash amount must match {peso(totalAmount)}.</p>}
        </div>

        {isGcashPayment && (
          <div className="sm:col-span-2">
            <label className={labelClass}>GCash Transaction # *</label>
            <input required value={form.gcash_reference} onChange={update('gcash_reference')} className={inputClass} placeholder="Enter GCash reference / transaction number" autoComplete="off" />
            <p className="mt-1 text-xs text-slate-500">Required for payment tracking and duplicate-reference checking.</p>
          </div>
        )}

        <div>
          <label className={labelClass}>Pickup Date{settings.require_pickup_date ? ' *' : ''}</label>
          <div className="flex gap-2">
            <input type="date" required={settings.require_pickup_date} value={form.pickup_date} onChange={(e) => setForm((f) => ({ ...f, pickup_date: e.target.value, pickup_time: e.target.value ? f.pickup_time : '' }))} className={`${inputClass} flex-1`} />
            <input type="time" value={form.pickup_time} onChange={update('pickup_time')} disabled={!form.pickup_date} title={!form.pickup_date ? 'Set a pickup date first' : 'Pickup time (optional)'} className={`${inputClass} w-32 disabled:opacity-50 disabled:cursor-not-allowed`} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Notes{settings.require_notes_for_pay_later && form.payment_method === 'pay_later' ? ' *' : ''}</label>
          <input required={settings.require_notes_for_pay_later && form.payment_method === 'pay_later'} value={form.notes} onChange={update('notes')} className={inputClass} />
        </div>
      </div>

      {error && <InlineAlert variant="error" title="Transaction was not saved">{error}</InlineAlert>}
      {success && <InlineAlert variant="success" title="Transaction saved">{success}</InlineAlert>}

      <button type="submit" disabled={submitting || servicesLoading || inventoryLoading} className="inline-flex items-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-medium rounded-lg px-4 py-2 text-sm transition">
        {submitting && <ButtonSpinner />}{submitting ? 'Saving…' : 'Add Transaction'}
      </button>
    </form>
  )
}
