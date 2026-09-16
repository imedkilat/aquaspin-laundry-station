import { useEffect, useState } from 'react'
import { useServices } from '../hooks/useServices'
import { supabase } from '../lib/supabase'
import type { Service } from '../types/database'

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'

export default function ServicePricingManager() {
  const { services, loading, reload } = useServices({ includeInactive: true })
  const [showAddService, setShowAddService] = useState(false)

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">Service Pricing</h2>
            <p className="text-sm text-slate-500 mt-1">
              Manage the shop's service catalog. Active services appear automatically on Staff transaction forms.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAddService((current) => !current)}
              className="bg-sky-600 hover:bg-sky-700 text-white font-medium rounded-lg px-4 py-2 text-sm transition"
            >
              {showAddService ? 'Cancel' : '+ Add Service'}
            </button>
            <button
              type="button"
              onClick={reload}
              disabled={loading}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {loading ? 'Refreshing…' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {showAddService && (
          <AddServiceForm
            services={services}
            onSaved={() => {
              setShowAddService(false)
              reload()
            }}
          />
        )}

        {loading ? (
          <p className="text-sm text-slate-400 py-6 text-center">Loading services…</p>
        ) : services.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">No services configured yet.</p>
        ) : (
          <div className="space-y-3">
            {services.map((service) => (
              <ServiceRateRow key={service.id} service={service} onSaved={reload} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AddServiceForm({ services, onSaved }: { services: Service[]; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [rate, setRate] = useState('')
  const [maxKg, setMaxKg] = useState('8')
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const save = async () => {
    const normalizedName = name.trim()
    const normalizedCode = code.trim().toUpperCase()
    const nextRate = Number(rate)
    const nextMaxKg = Number(maxKg)

    if (!normalizedName) {
      setMessage('Service Name is required.')
      return
    }
    if (!/^[A-Z0-9_-]{2,12}$/.test(normalizedCode)) {
      setMessage('Short Code must be 2–12 letters/numbers, with optional - or _.')
      return
    }
    if (services.some((service) => service.code.toUpperCase() === normalizedCode)) {
      setMessage(`Service code ${normalizedCode} already exists.`)
      return
    }
    if (!Number.isFinite(nextRate) || nextRate < 0) {
      setMessage('Enter a valid non-negative price per load.')
      return
    }
    if (!Number.isFinite(nextMaxKg) || nextMaxKg <= 0) {
      setMessage('Kg per load must be greater than 0.')
      return
    }

    setSaving(true)
    setMessage(null)
    const { error } = await supabase.from('services').insert({
      code: normalizedCode,
      label: normalizedName,
      default_rate: nextRate,
      pricing_type: 'per_load_by_weight',
      max_kg_per_load: nextMaxKg,
      active,
    })
    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }

    onSaved()
  }

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4 dark:border-sky-900 dark:bg-sky-950/20">
      <div className="mb-4">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">Add New Service</h3>
        <p className="text-xs text-slate-500 mt-1">
          New services use automatic weight-based billing. The default shop rule is 8 kg per load, but the Owner can set a different capacity when needed.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="lg:col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Service Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            placeholder="e.g. Premium Wash-Dry-Fold"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Short Code *</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className={inputClass}
            placeholder="e.g. PWDF"
            maxLength={12}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Price / Load (₱) *</label>
          <input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className={inputClass} placeholder="0.00" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Kg / Load *</label>
          <input type="number" min="0.1" step="0.1" value={maxKg} onChange={(e) => setMaxKg(e.target.value)} className={inputClass} />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 md:self-end md:pb-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4" />
          Active immediately
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-medium rounded-lg px-4 py-2 text-sm transition"
        >
          {saving ? 'Adding…' : 'Add Service'}
        </button>
        {message && <p className="text-xs text-red-600 dark:text-red-400">{message}</p>}
      </div>
    </div>
  )
}

function ServiceRateRow({ service, onSaved }: { service: Service; onSaved: () => void }) {
  const [rate, setRate] = useState(service.default_rate == null ? '' : String(service.default_rate))
  const [maxKg, setMaxKg] = useState(service.max_kg_per_load == null ? '8' : String(service.max_kg_per_load))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setRate(service.default_rate == null ? '' : String(service.default_rate))
    setMaxKg(service.max_kg_per_load == null ? '8' : String(service.max_kg_per_load))
  }, [service.default_rate, service.max_kg_per_load])

  const save = async () => {
    const nextRate = Number(rate)
    const nextMaxKg = Number(maxKg)
    if (!Number.isFinite(nextRate) || nextRate < 0) {
      setMessage('Enter a valid non-negative rate.')
      return
    }
    if (!Number.isFinite(nextMaxKg) || nextMaxKg <= 0) {
      setMessage('Kg per load must be greater than 0.')
      return
    }

    setSaving(true)
    setMessage(null)
    const { error } = await supabase
      .from('services')
      .update({ default_rate: nextRate, max_kg_per_load: nextMaxKg })
      .eq('id', service.id)
    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage('Saved. Open Staff screens will sync automatically.')
    onSaved()
  }

  const toggleActive = async () => {
    setSaving(true)
    setMessage(null)
    const { error } = await supabase.from('services').update({ active: !service.active }).eq('id', service.id)
    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage(service.active ? 'Service deactivated. Historical transactions are preserved.' : 'Service activated and available to Staff.')
    onSaved()
  }

  return (
    <div className={`rounded-xl border p-4 dark:border-slate-700 ${service.active ? 'border-slate-200' : 'border-slate-200 bg-slate-50/70 opacity-75 dark:bg-slate-950/30'}`}>
      <div className="flex flex-col lg:flex-row lg:items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-slate-900 dark:text-slate-100">{service.label}</p>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${service.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
              {service.active ? 'Active' : 'Inactive'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{service.code} · automatic weight-based billing</p>
        </div>
        <div className="w-full sm:w-40">
          <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Price / Load (₱)</label>
          <input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className={inputClass} />
        </div>
        <div className="w-full sm:w-32">
          <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Kg / Load</label>
          <input type="number" min="0.1" step="0.1" value={maxKg} onChange={(e) => setMaxKg(e.target.value)} className={inputClass} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-medium rounded-lg px-4 py-2 text-sm transition"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={toggleActive}
            disabled={saving}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {service.active ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      </div>
      {message && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{message}</p>}
    </div>
  )
}
