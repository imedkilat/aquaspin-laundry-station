import { useEffect, useState } from 'react'
import { useServices } from '../hooks/useServices'
import { supabase } from '../lib/supabase'
import type { Service } from '../types/database'

export default function ServicePricingManager() {
  const { services, loading, reload } = useServices()

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 dark:bg-slate-900 dark:border-slate-800">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Service Pricing</h2>
          <p className="text-sm text-slate-500 mt-1">Change the price per load here. Every service uses the 8 kg/load rule, and open staff screens sync automatically.</p>
        </div>
        <button type="button" onClick={reload} disabled={loading} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 py-6 text-center">Loading services…</p>
      ) : (
        <div className="space-y-3">
          {services.map((service) => <ServiceRateRow key={service.id} service={service} onSaved={reload} />)}
        </div>
      )}
    </div>
  )
}

function ServiceRateRow({ service, onSaved }: { service: Service; onSaved: () => void }) {
  const [rate, setRate] = useState(service.default_rate == null ? '' : String(service.default_rate))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setRate(service.default_rate == null ? '' : String(service.default_rate))
  }, [service.default_rate])

  const save = async () => {
    const nextRate = Number(rate)
    if (!Number.isFinite(nextRate) || nextRate < 0) {
      setMessage('Enter a valid non-negative rate.')
      return
    }

    setSaving(true)
    setMessage(null)
    const { error } = await supabase.from('services').update({ default_rate: nextRate }).eq('id', service.id)
    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage('Saved. Staff pricing will sync automatically.')
    onSaved()
  }

  return (
    <div className="rounded-xl border border-slate-200 p-4 flex flex-col md:flex-row md:items-center gap-3 dark:border-slate-700">
      <div className="flex-1">
        <p className="font-medium text-slate-900 dark:text-slate-100">{service.label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{service.code} · 8 kg per load</p>
      </div>
      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Price / load (₱)</label>
          <input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button type="button" onClick={save} disabled={saving} className="bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-medium rounded-lg px-4 py-2 text-sm transition">
          {saving ? 'Saving…' : 'Save Price'}
        </button>
      </div>
      {message && <p className="text-xs text-slate-500 md:w-56">{message}</p>}
    </div>
  )
}
