import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useServices } from '../hooks/useServices'
import { useAuth } from '../lib/auth-context'
import type { PaymentMethod } from '../types/database'
import { shopDate } from '../lib/date'

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
  payment_method: 'pay_later' as PaymentMethod,
  pickup_date: '',
  notes: '',
}

export default function TransactionForm({ onAdded }: { onAdded?: () => void }) {
  const { services } = useServices()
  const { profile } = useAuth()
  const [form, setForm] = useState(emptyForm)
  const [totalTouched, setTotalTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const selectedService = useMemo(
    () => services.find((service) => service.id === form.service_id) ?? null,
    [form.service_id, services]
  )

  const isWeightBased =
    selectedService?.pricing_type === 'per_load_by_weight' &&
    selectedService.max_kg_per_load != null &&
    selectedService.max_kg_per_load > 0

  // Reset service-derived fields whenever a different service is selected.
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
    // Only reset when the chosen service changes. Weight changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.service_id, selectedService?.id, isWeightBased])

  // Weight-based services calculate loads and base price automatically.
  // Example: 11.3 kg at 8 kg/load => 2 loads under one transaction number.
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

  // Total defaults to base + add-ons unless the staff member overrides it.
  useEffect(() => {
    if (totalTouched) return
    const base = parseFloat(form.base_amount) || 0
    const addOns = parseFloat(form.add_ons) || 0
    setForm((f) => ({ ...f, total_amount: (base + addOns).toFixed(2) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.base_amount, form.add_ons, totalTouched])

  const update = (field: keyof typeof emptyForm) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setSubmitting(true)

    const { error } = await supabase.from('transactions').insert({
      customer_name: form.customer_name.trim(),
      phone_number: form.phone_number.trim() || null,
      transaction_date: form.transaction_date,
      service_id: form.service_id || null,
      kg: form.kg ? Number(form.kg) : null,
      no_of_loads: form.no_of_loads ? Number(form.no_of_loads) : null,
      base_amount: form.base_amount ? Number(form.base_amount) : 0,
      add_ons: form.add_ons ? Number(form.add_ons) : 0,
      total_amount: form.total_amount ? Number(form.total_amount) : 0,
      cash_amount: form.cash_amount ? Number(form.cash_amount) : 0,
      gcash_amount: form.gcash_amount ? Number(form.gcash_amount) : 0,
      payment_method: form.payment_method,
      pickup_date: form.pickup_date || null,
      notes: form.notes.trim() || null,
      created_by: profile?.id ?? null,
    })

    setSubmitting(false)

    if (error) {
      setError(error.message)
      return
    }

    setSuccess(`Added — ${form.customer_name.trim()}`)
    setForm(emptyForm)
    setTotalTouched(false)
    onAdded?.()
    setTimeout(() => setSuccess(null), 3000)
  }

  const inputClass =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500'
  const autoInputClass = `${inputClass} bg-slate-50 text-slate-700 cursor-not-allowed`
  const labelClass = 'block text-xs font-medium text-slate-600 mb-1'

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <h2 className="font-semibold text-slate-900">Add Customer Transaction</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Customer Name *</label>
          <input required value={form.customer_name} onChange={update('customer_name')} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Phone Number</label>
          <input
            value={form.phone_number}
            onChange={update('phone_number')}
            className={inputClass}
            placeholder="09xxxxxxxxx"
          />
        </div>

        <div>
          <label className={labelClass}>Transaction Date *</label>
          <input
            type="date"
            required
            value={form.transaction_date}
            onChange={update('transaction_date')}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Service</label>
          <select value={form.service_id} onChange={update('service_id')} className={inputClass}>
            <option value="">Select service…</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({s.code})
              </option>
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
            <p className="mt-1 text-xs text-sky-700">
              Auto rule: up to {selectedService.max_kg_per_load} kg per load
            </p>
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
            <p className="mt-1 text-xs text-slate-500">
              {form.kg} kg = {form.no_of_loads} load{form.no_of_loads === '1' ? '' : 's'}, same transaction #
            </p>
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
            <p className="mt-1 text-xs text-slate-500">
              ₱{selectedService.default_rate.toFixed(2)} × {form.no_of_loads} load{form.no_of_loads === '1' ? '' : 's'}
            </p>
          )}
        </div>
        <div>
          <label className={labelClass}>Add-ons (₱)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.add_ons}
            onChange={update('add_ons')}
            className={inputClass}
          />
        </div>

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
          <select
            required
            value={form.payment_method}
            onChange={update('payment_method')}
            className={inputClass}
          >
            <option value="paid">Paid</option>
            <option value="gcash">GCash</option>
            <option value="pay_later">Pay Later</option>
          </select>
        </div>

        <div>
          <label className={labelClass}>Cash Received (₱)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.cash_amount}
            onChange={update('cash_amount')}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>GCash Received (₱)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.gcash_amount}
            onChange={update('gcash_amount')}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>Pickup Date</label>
          <input type="date" value={form.pickup_date} onChange={update('pickup_date')} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Notes</label>
          <input value={form.notes} onChange={update('notes')} className={inputClass} />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}
      {success && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          {success}
        </p>
      )}

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
