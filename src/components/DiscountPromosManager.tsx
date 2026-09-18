import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAddOns } from '../hooks/useAddOns'
import { useDiscountPromos } from '../hooks/useDiscountPromos'
import { useServices } from '../hooks/useServices'
import { useAuth } from '../lib/auth-context'
import type {
  DiscountAppliesTo,
  DiscountPromo,
  DiscountPromoKind,
  DiscountType,
} from '../types/database'
import { ButtonSpinner, InlineAlert, LoadingPanel } from './UiFeedback'

type Notice = { type: 'success' | 'error'; text: string } | null

type FormState = {
  name: string
  kind: DiscountPromoKind
  discount_type: DiscountType
  discount_value: string
  occasion: string
  applies_to: DiscountAppliesTo
  service_id: string
  add_on_id: string
  starts_at: string
  ends_at: string
  active: boolean
  notes: string
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'
const labelClass = 'block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400'

const localDateTime = (value: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return value.getFullYear() + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate()) + 'T' + pad(value.getHours()) + ':' + pad(value.getMinutes())
}

const toLocalDateTime = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : localDateTime(date)
}

const fromLocalDateTime = (value: string) => new Date(value).toISOString()

const makeEmptyForm = (): FormState => {
  const start = new Date()
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
  return {
    name: '',
    kind: 'promo',
    discount_type: 'percentage',
    discount_value: '',
    occasion: '',
    applies_to: 'all',
    service_id: '',
    add_on_id: '',
    starts_at: localDateTime(start),
    ends_at: localDateTime(end),
    active: true,
    notes: '',
  }
}

const peso = (value: number) =>
  '₱' + value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const discountLabel = (promo: Pick<DiscountPromo, 'discount_type' | 'discount_value'>) =>
  promo.discount_type === 'percentage' ? promo.discount_value + '% off' : peso(promo.discount_value) + ' off'

const statusFor = (promo: DiscountPromo) => {
  if (!promo.active) return { label: 'Disabled', className: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300' }
  const now = Date.now()
  if (now < new Date(promo.starts_at).getTime()) return { label: 'Scheduled', className: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300' }
  if (now > new Date(promo.ends_at).getTime()) return { label: 'Expired', className: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' }
  return { label: 'Live now', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' }
}

const displayDate = (value: string) =>
  new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })

export default function DiscountPromosManager() {
  const { profile } = useAuth()
  const { promos, loading, error, realtimeState, reload } = useDiscountPromos({ includeInactive: true })
  const { services } = useServices({ includeInactive: true })
  const { addOns } = useAddOns({ includeInactive: true })
  const [form, setForm] = useState<FormState>(() => makeEmptyForm())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  const sortedPromos = useMemo(() => {
    return [...promos].sort((a, b) => {
      const statusRank = (promo: DiscountPromo) => {
        const status = statusFor(promo).label
        return status === 'Live now' ? 0 : status === 'Scheduled' ? 1 : status === 'Expired' ? 2 : 3
      }
      return statusRank(a) - statusRank(b) || new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    })
  }, [promos])

  const reset = () => {
    setForm(makeEmptyForm())
    setEditingId(null)
  }

  const edit = (promo: DiscountPromo) => {
    setEditingId(promo.id)
    setForm({
      name: promo.name,
      kind: promo.kind,
      discount_type: promo.discount_type,
      discount_value: String(promo.discount_value),
      occasion: promo.occasion ?? '',
      applies_to: promo.applies_to,
      service_id: promo.service_id ?? '',
      add_on_id: promo.add_on_id ?? '',
      starts_at: toLocalDateTime(promo.starts_at),
      ends_at: toLocalDateTime(promo.ends_at),
      active: promo.active,
      notes: promo.notes ?? '',
    })
    setNotice(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const save = async () => {
    const name = form.name.trim()
    const value = Number(form.discount_value)
    const startsAt = new Date(form.starts_at)
    const endsAt = new Date(form.ends_at)

    if (!name || !Number.isFinite(value) || value <= 0) {
      setNotice({ type: 'error', text: 'Enter a name and a discount value greater than zero.' })
      return
    }
    if (form.discount_type === 'percentage' && value > 100) {
      setNotice({ type: 'error', text: 'Percentage discounts cannot exceed 100%.' })
      return
    }
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      setNotice({ type: 'error', text: 'The end date and time must be after the start date and time.' })
      return
    }
    if (form.applies_to === 'service' && !form.service_id) {
      setNotice({ type: 'error', text: 'Choose the service this discount applies to.' })
      return
    }
    if (form.applies_to === 'add_on' && !form.add_on_id) {
      setNotice({ type: 'error', text: 'Choose the add-on this discount applies to.' })
      return
    }

    const payload = {
      name,
      kind: form.kind,
      discount_type: form.discount_type,
      discount_value: value,
      occasion: form.occasion.trim() || null,
      applies_to: form.applies_to,
      service_id: form.applies_to === 'service' ? form.service_id : null,
      add_on_id: form.applies_to === 'add_on' ? form.add_on_id : null,
      starts_at: fromLocalDateTime(form.starts_at),
      ends_at: fromLocalDateTime(form.ends_at),
      active: form.active,
      notes: form.notes.trim() || null,
      updated_by: profile?.id ?? null,
    }

    setSaving(true)
    setNotice(null)
    const result = editingId
      ? await supabase.from('discounts_promos').update(payload).eq('id', editingId)
      : await supabase.from('discounts_promos').insert({ ...payload, created_by: profile?.id ?? null })

    setSaving(false)
    if (result.error) {
      setNotice({ type: 'error', text: result.error.message })
      return
    }

    setNotice({ type: 'success', text: editingId ? 'Discount or promo updated. Open Staff order screens sync automatically.' : 'Discount or promo added. Open Staff order screens sync automatically.' })
    reset()
    void reload()
  }

  const toggleActive = async (promo: DiscountPromo) => {
    const { error: updateError } = await supabase
      .from('discounts_promos')
      .update({ active: !promo.active, updated_by: profile?.id ?? null })
      .eq('id', promo.id)
    if (updateError) {
      setNotice({ type: 'error', text: updateError.message })
      return
    }
    setNotice({ type: 'success', text: 'Promo status updated and synced to Staff screens.' })
    void reload()
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-5 dark:border-sky-900/60 dark:bg-sky-950/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-600 dark:text-sky-400">Owner tools</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">Discounts & Promos</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Schedule seasonal offers and make them available to Staff in real time.</p>
          </div>
          <span className="rounded-full bg-sky-600 px-3 py-1 text-xs font-semibold text-white">Staff selects per order</span>
        </div>
      </div>

      {notice && <InlineAlert variant={notice.type} title={notice.type === 'error' ? 'Could not save offer' : 'Offer updated'}>{notice.text}</InlineAlert>}
      {error && <InlineAlert variant="error" title="Discounts and promos could not be loaded" actionLabel="Try again" onAction={() => void reload()}>{error}</InlineAlert>}
      {!error && (realtimeState === 'disconnected' || realtimeState === 'error') && (
        <InlineAlert variant="warning" title="Live promo sync is temporarily offline" actionLabel="Refresh" onAction={() => void reload()}>
          Changes are still saved, but open Staff screens may need a manual Refresh until Realtime reconnects.
        </InlineAlert>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">{editingId ? 'Edit discount or promo' : 'Add discount or promo'}</h3>
            <p className="mt-1 text-xs text-slate-500">Use the timeline for seasonal offers. Promo is optional when creating an order.</p>
          </div>
          {editingId && <button type="button" onClick={reset} className="text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">Cancel edit</button>}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>Name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} placeholder="Christmas Wash Promo" />
          </div>
          <div>
            <label className={labelClass}>Occasion / season</label>
            <input value={form.occasion} onChange={(e) => setForm({ ...form, occasion: e.target.value })} className={inputClass} placeholder="Christmas, Fiesta, Back to School" />
          </div>
          <div>
            <label className={labelClass}>Offer type *</label>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as DiscountPromoKind })} className={inputClass}>
              <option value="discount">Discount</option>
              <option value="promo">Promo</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Discount format *</label>
            <select value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value as DiscountType })} className={inputClass}>
              <option value="percentage">Percentage (%)</option>
              <option value="fixed">Fixed amount (₱)</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Value *</label>
            <input type="number" min="0.01" step="0.01" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} className={inputClass} placeholder={form.discount_type === 'percentage' ? '10' : '50'} />
          </div>
          <div>
            <label className={labelClass}>Applies to *</label>
            <select value={form.applies_to} onChange={(e) => setForm({ ...form, applies_to: e.target.value as DiscountAppliesTo, service_id: '', add_on_id: '' })} className={inputClass}>
              <option value="all">All services and add-ons</option>
              <option value="service">One service</option>
              <option value="add_on">One add-on</option>
            </select>
          </div>

          {form.applies_to === 'service' && (
            <div>
              <label className={labelClass}>Service *</label>
              <select value={form.service_id} onChange={(e) => setForm({ ...form, service_id: e.target.value })} className={inputClass}>
                <option value="">Select service…</option>
                {services.map((service) => <option key={service.id} value={service.id}>{service.label} ({service.code})</option>)}
              </select>
            </div>
          )}
          {form.applies_to === 'add_on' && (
            <div>
              <label className={labelClass}>Add-on *</label>
              <select value={form.add_on_id} onChange={(e) => setForm({ ...form, add_on_id: e.target.value })} className={inputClass}>
                <option value="">Select add-on…</option>
                {addOns.map((addOn) => <option key={addOn.id} value={addOn.id}>{addOn.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className={labelClass}>Starts *</label>
            <input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Ends *</label>
            <input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} className={inputClass} />
          </div>
          <div className="md:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Available to Staff
            </label>
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputClass} rows={2} placeholder="Terms, minimum load, or internal reminder" />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60">
            {saving && <ButtonSpinner />}{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add discount or promo'}
          </button>
          {editingId && <button type="button" onClick={reset} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Cancel</button>}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">Offer timeline</h3>
            <p className="mt-1 text-xs text-slate-500">{promos.length} configured offer{promos.length === 1 ? '' : 's'} · Staff only sees offers marked Available to Staff.</p>
          </div>
          <button type="button" onClick={() => void reload()} disabled={loading} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">{loading ? 'Refreshing…' : '↻ Refresh'}</button>
        </div>
        {loading ? <LoadingPanel label="Loading discounts and promos…" slowLabel="Still loading offers…" /> : sortedPromos.length === 0 ? <p className="py-4 text-sm text-slate-500">No discounts or promos yet. Add the first seasonal offer above.</p> : (
          <div className="space-y-3">
            {sortedPromos.map((promo) => {
              const status = statusFor(promo)
              const target = promo.applies_to === 'service'
                ? services.find((service) => service.id === promo.service_id)?.label ?? 'Selected service'
                : promo.applies_to === 'add_on'
                  ? addOns.find((addOn) => addOn.id === promo.add_on_id)?.name ?? 'Selected add-on'
                  : 'All services and add-ons'
              return (
                <div key={promo.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-semibold text-slate-900 dark:text-slate-100">{promo.name}</h4>
                        <span className={'rounded-full px-2 py-0.5 text-xs font-medium ' + status.className}>{status.label}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{promo.kind === 'discount' ? 'Discount' : 'Promo'}</span>
                      </div>
                      <p className="mt-1 text-sm text-sky-700 dark:text-sky-300">{discountLabel(promo)} · {target}</p>
                      {promo.occasion && <p className="mt-1 text-xs text-slate-500">Occasion: {promo.occasion}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => edit(promo)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Edit</button>
                      <button type="button" onClick={() => void toggleActive(promo)} className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/30">{promo.active ? 'Disable' : 'Enable'}</button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-500 sm:grid-cols-2">
                    <span>Starts: {displayDate(promo.starts_at)}</span>
                    <span>Ends: {displayDate(promo.ends_at)}</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className={'h-full rounded-full ' + (status.label === 'Live now' ? 'bg-emerald-500' : status.label === 'Scheduled' ? 'bg-violet-500' : 'bg-slate-400')} style={{ width: status.label === 'Live now' ? '100%' : status.label === 'Scheduled' ? '35%' : '100%' }} />
                  </div>
                  {promo.notes && <p className="mt-2 text-xs text-slate-500">{promo.notes}</p>}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
