import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useServices } from '../hooks/useServices'
import { useAddOns } from '../hooks/useAddOns'
import { useAuth } from '../lib/auth-context'
import type { PaymentMethod, TransactionAddOnItem } from '../types/database'
import { shopDate } from '../lib/date'
import { toTitleCaseName } from '../lib/text'

const emptyForm = {
  customer_name: '',
  phone_number: '',
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
  payment_method: 'pay_later' as PaymentMethod,
  pickup_date: '',
  pickup_time: '',
  notes: '',
}

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const unitLabel = (unit: string, quantity = 1) => {
  if (unit === 'flat') return 'flat'
  return quantity === 1 ? unit : `${unit}s`
}

export default function TransactionForm({ onAdded }: { onAdded?: () => void }) {
  const { services } = useServices()
  const { addOns, loading: addOnsLoading } = useAddOns()
  const { profile } = useAuth()
  const [form, setForm] = useState(emptyForm)
  const [selectedAddOns, setSelectedAddOns] = useState<Record<string, number>>({})
  const [totalTouched, setTotalTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // One idempotency key per open form. Every submit attempt from this form
  // instance (including a double-click that fires before the button's
  // `disabled` prop re-renders) reuses the same key, so a duplicate insert
  // collides on the database's unique index instead of creating a second
  // transaction. A plain ref (not state) guards re-entrancy synchronously,
  // before React has a chance to re-render anything.
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
    if (totalTouched) return
    const base = parseFloat(form.base_amount) || 0
    const addOnAmount = parseFloat(form.add_ons) || 0
    setForm((f) => ({ ...f, total_amount: (base + addOnAmount).toFixed(2) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.base_amount, form.add_ons, totalTouched])

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

  const update = (field: keyof typeof emptyForm) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [field]: e.target.value }))

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    // Synchronous guard: blocks a second submit fired before React has
    // re-rendered the button as disabled (e.g. a fast double-click).
    if (submitLockRef.current) return
    submitLockRef.current = true

    try {
      setError(null)
      setSuccess(null)

      const normalizedCustomerName = toTitleCaseName(form.customer_name)
      if (!normalizedCustomerName) {
        setError('Customer name is required.')
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

      const { error } = await supabase.from('transactions').insert({
        customer_name: normalizedCustomerName,
        phone_number: form.phone_number.trim() || null,
        transaction_date: form.transaction_date,
        service_id: form.service_id || null,
        kg: form.kg ? Number(form.kg) : null,
        no_of_loads: form.no_of_loads ? Number(form.no_of_loads) : null,
        base_amount: form.base_amount ? Number(form.base_amount) : 0,
        add_ons: addOnsTotal,
        add_on_items: selectedAddOnItems,
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

      if (error) {
        if (error.message.toLowerCase().includes('transactions_gcash_reference_unique_idx')) {
          setError('That GCash Transaction # is already attached to another transaction.')
        } else if (error.message.toLowerCase().includes('transactions_client_request_id_unique_idx')) {
          // The exact same submit was already saved (a double-click or a
          // retried request) -- not a real error, nothing lost.
          setSuccess(`Added — ${normalizedCustomerName} (duplicate click ignored)`)
          setForm(emptyForm)
          setSelectedAddOns({})
          setTotalTouched(false)
          setClientRequestId(crypto.randomUUID())
          onAdded?.()
          setTimeout(() => setSuccess(null), 4000)
        } else {
          setError(error.message)
        }
        return
      }

      const changeMessage = form.payment_method === 'paid' && changeDue > 0 ? ` · Change ${peso(changeDue)}` : ''
      const gcashMessage = form.payment_method === 'gcash' ? ` · GCash #${form.gcash_reference.trim()}` : ''
      const addOnMessage = selectedAddOnItems.length > 0 ? ` · Add-ons ${peso(addOnsTotal)}` : ''
      setSuccess(`Added — ${normalizedCustomerName}${addOnMessage}${changeMessage}${gcashMessage}`)
      setForm(emptyForm)
      setSelectedAddOns({})
      setTotalTouched(false)
      setClientRequestId(crypto.randomUUID())
      onAdded?.()
      setTimeout(() => setSuccess(null), 4000)
    } finally {
      submitLockRef.current = false
    }
  }

  const inputClass =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'
  const autoInputClass = `${inputClass} bg-slate-50 text-slate-700 cursor-not-allowed dark:bg-slate-800 dark:text-slate-300`
  const labelClass = 'block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400'

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5 dark:bg-slate-900 dark:border-slate-800">
      <h2 className="font-semibold text-slate-900 dark:text-slate-100">Add Customer Transaction</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Customer Name *</label>
          <input
            required
            value={form.customer_name}
            onChange={update('customer_name')}
            onBlur={() => setForm((f) => ({ ...f, customer_name: toTitleCaseName(f.customer_name) }))}
            className={inputClass}
            placeholder="Earl Dela Cruz"
          />
        </div>
        <div>
          <label className={labelClass}>Phone Number</label>
          <input value={form.phone_number} onChange={update('phone_number')} className={inputClass} placeholder="09xxxxxxxxx" />
        </div>

        <div>
          <label className={labelClass}>Transaction Date *</label>
          <input type="date" required value={form.transaction_date} onChange={update('transaction_date')} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Service</label>
          <select value={form.service_id} onChange={update('service_id')} className={inputClass}>
            <option value="">Select service…</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.label} ({s.code})</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Kg{isWeightBased ? ' *' : ''}</label>
          <input
            type="number"
            step="0.1"
            min={isWeightBased ? '0.1' : '0'}
            required={isWeightBased}
            value={form.kg}
            onChange={update('kg')}
            className={inputClass}
          />
          {isWeightBased && selectedService?.max_kg_per_load && (
            <p className="mt-1 text-xs text-sky-700 dark:text-sky-400">Auto rule: up to {selectedService.max_kg_per_load} kg per load</p>
          )}
        </div>
        <div>
          <label className={labelClass}>No. of Loads{isWeightBased ? ' · Auto' : ''}</label>
          <input
            type="number"
            min="0"
            value={form.no_of_loads}
            onChange={isWeightBased ? undefined : update('no_of_loads')}
            readOnly={isWeightBased}
            placeholder={isWeightBased ? 'Enter kg first' : undefined}
            className={isWeightBased ? autoInputClass : inputClass}
          />
          {isWeightBased && form.no_of_loads && (
            <p className="mt-1 text-xs text-slate-500">{form.kg} kg = {form.no_of_loads} load{form.no_of_loads === '1' ? '' : 's'}, same transaction #</p>
          )}
        </div>

        <div>
          <label className={labelClass}>Base Amount (₱){isWeightBased ? ' · Auto' : ''}</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.base_amount}
            onChange={isWeightBased ? undefined : update('base_amount')}
            readOnly={isWeightBased}
            className={isWeightBased ? autoInputClass : inputClass}
          />
          {isWeightBased && form.no_of_loads && selectedService?.default_rate != null && (
            <p className="mt-1 text-xs text-slate-500">₱{selectedService.default_rate.toFixed(2)} × {form.no_of_loads} load{form.no_of_loads === '1' ? '' : 's'}</p>
          )}
        </div>
        <div>
          <label className={labelClass}>Add-ons Total (₱) · Auto</label>
          <input type="number" value={form.add_ons} readOnly className={autoInputClass} />
          <p className="mt-1 text-xs text-slate-500">Select add-ons below. Prices and quantities are tracked with the transaction.</p>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Add-ons</h3>
            <p className="text-xs text-slate-500">Optional. Check an item and enter the quantity used.</p>
          </div>
          {selectedAddOnItems.length > 0 && <span className="text-sm font-semibold text-sky-600">{peso(addOnsTotal)}</span>}
        </div>

        {addOnsLoading ? (
          <p className="text-sm text-slate-400 py-3">Loading add-ons…</p>
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
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => toggleAddOn(addOn.id, e.target.checked)}
                      className="mt-1 h-4 w-4"
                    />
                    <span className="flex-1">
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{addOn.name}</span>
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{peso(addOn.price)} / {addOn.unit_type}</span>
                      </span>
                      {selected && (
                        <span className="mt-3 flex items-end justify-between gap-3">
                          <span className="w-28">
                            <span className="block text-xs text-slate-500 mb-1">Quantity</span>
                            <input
                              type="number"
                              min={decimalQuantity ? '0.1' : '1'}
                              step={decimalQuantity ? '0.1' : '1'}
                              disabled={addOn.unit_type === 'flat'}
                              value={effectiveQuantity}
                              onChange={(e) => updateAddOnQuantity(addOn.id, e.target.value, decimalQuantity)}
                              onClick={(e) => e.stopPropagation()}
                              className={`${inputClass} py-1.5 disabled:opacity-60`}
                            />
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Total (₱)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.total_amount}
            onChange={(e) => {
              setTotalTouched(true)
              setForm((f) => ({ ...f, total_amount: e.target.value }))
            }}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Payment Method *</label>
          <select required value={form.payment_method} onChange={update('payment_method')} className={inputClass}>
            <option value="paid">Cash</option>
            <option value="gcash">GCash</option>
            <option value="pay_later">Pay Later</option>
          </select>
        </div>

        <div>
          <label className={labelClass}>Cash Received (₱){isCashPayment ? ' *' : ''}</label>
          <input
            type="number"
            step="0.01"
            min="0"
            required={isCashPayment}
            disabled={!isCashPayment}
            value={form.cash_amount}
            onChange={update('cash_amount')}
            className={`${inputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
            placeholder={isCashPayment ? 'Amount tendered by customer' : 'Select Cash payment'}
          />
          {isCashPayment && cashEntered && cashShort > 0 && <p className="mt-1 text-xs font-medium text-red-600">Short by {peso(cashShort)}. Transaction cannot be saved.</p>}
          {isCashPayment && cashEntered && cashDifference === 0 && <p className="mt-1 text-xs font-medium text-emerald-600">Exact payment. No change due.</p>}
          {isCashPayment && cashEntered && changeDue > 0 && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">Change due: <strong>{peso(changeDue)}</strong></div>
          )}
        </div>

        <div>
          <label className={labelClass}>GCash Received (₱){isGcashPayment ? ' *' : ''}</label>
          <input
            type="number"
            step="0.01"
            min="0"
            required={isGcashPayment}
            disabled={!isGcashPayment}
            value={form.gcash_amount}
            onChange={update('gcash_amount')}
            className={`${inputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
            placeholder={isGcashPayment ? 'GCash amount received' : 'Select GCash payment'}
          />
          {isGcashPayment && gcashEntered && gcashDifference === 0 && <p className="mt-1 text-xs font-medium text-emerald-600">GCash amount matches the total.</p>}
          {isGcashPayment && gcashEntered && gcashDifference !== 0 && <p className="mt-1 text-xs font-medium text-red-600">GCash amount must match {peso(totalAmount)}.</p>}
        </div>

        {isGcashPayment && (
          <div className="sm:col-span-2">
            <label className={labelClass}>GCash Transaction # *</label>
            <input
              required
              value={form.gcash_reference}
              onChange={update('gcash_reference')}
              className={inputClass}
              placeholder="Enter GCash reference / transaction number"
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-slate-500">Required for payment tracking and duplicate-reference checking.</p>
          </div>
        )}

        <div>
          <label className={labelClass}>Pickup Date</label>
          <div className="flex gap-2">
            <input
              type="date"
              value={form.pickup_date}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  pickup_date: e.target.value,
                  pickup_time: e.target.value ? f.pickup_time : '',
                }))
              }
              className={`${inputClass} flex-1`}
            />
            <input
              type="time"
              value={form.pickup_time}
              onChange={update('pickup_time')}
              disabled={!form.pickup_date}
              placeholder="Time"
              title={!form.pickup_date ? 'Set a pickup date first' : 'Pickup time (optional)'}
              className={`${inputClass} w-32 disabled:opacity-50 disabled:cursor-not-allowed`}
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>Notes</label>
          <input value={form.notes} onChange={update('notes')} className={inputClass} />
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {success && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{success}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-medium rounded-lg px-4 py-2 text-sm transition"
      >
        {submitting ? 'Saving…' : 'Add Transaction'}
      </button>
    </form>
  )
}
