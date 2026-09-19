import { useEffect, useState, type FormEvent } from 'react'
import { useAddOns } from '../hooks/useAddOns'
import { supabase } from '../lib/supabase'
import { toTitleCaseName } from '../lib/text'
import type { AddOn, AddOnUnit } from '../types/database'
import { ButtonSpinner, EmptyState, InlineAlert, LoadingPanel } from './UiFeedback'

const UNIT_OPTIONS: Array<{ value: AddOnUnit; label: string; example: string }> = [
  { value: 'piece', label: 'Per piece', example: 'hanger, laundry bag, ironing' },
  { value: 'load', label: 'Per load', example: 'extra rinse, premium wash additive' },
  { value: 'sachet', label: 'Per sachet', example: 'Downy, detergent, bleach sachet' },
  { value: 'dose', label: 'Per dose', example: 'liquid conditioner or detergent dose' },
  { value: 'cycle', label: 'Per cycle', example: 'extra dry cycle' },
  { value: 'kg', label: 'Per kg', example: 'weight-based special treatment' },
  { value: 'ml', label: 'Per ml', example: 'liquid detergent or conditioner' },
  { value: 'flat', label: 'Flat fee', example: 'stain treatment or rush handling' },
]

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
type Notice = { type: 'error' | 'success'; text: string } | null

export default function AddOnsManager() {
  const { addOns, loading, error: loadError, realtimeState, reload } = useAddOns({ includeInactive: true })
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [unitType, setUnitType] = useState<AddOnUnit>('piece')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  const addItem = async (event: FormEvent) => {
    event.preventDefault()
    setNotice(null)

    const normalizedName = toTitleCaseName(name)
    const numericPrice = Number(price)
    if (!normalizedName) return setNotice({ type: 'error', text: 'Add-on name is required.' })
    if (!Number.isFinite(numericPrice) || numericPrice < 0) return setNotice({ type: 'error', text: 'Enter a valid non-negative price.' })

    setSaving(true)
    const { error } = await supabase.from('add_ons_catalog').insert({ name: normalizedName, price: numericPrice, unit_type: unitType, active: true })
    setSaving(false)

    if (error) {
      if (error.message.toLowerCase().includes('add_ons_catalog_name_unique_idx')) setNotice({ type: 'error', text: 'An add-on with that name already exists.' })
      else setNotice({ type: 'error', text: error.message })
      return
    }

    setName(''); setPrice(''); setUnitType('piece')
    setNotice({ type: 'success', text: `${normalizedName} added to the Staff transaction form.` })
    void reload()
  }

  return (
    <div className="space-y-5">
      <form onSubmit={addItem} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 dark:bg-slate-900 dark:border-slate-800">
        <div><h2 className="font-semibold text-slate-900 dark:text-slate-100">Add Add-on</h2><p className="text-sm text-slate-500 mt-1">Add optional products or services Staff can attach to a transaction. Price changes affect new transactions only.</p></div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Product / Add-on Name</label><input required value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setName((current) => toTitleCaseName(current))} placeholder="Downy" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Price (₱)</label><input required type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="20.00" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Charge Unit</label><select value={unitType} onChange={(e) => setUnitType(e.target.value as AddOnUnit)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">{UNIT_OPTIONS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></div>
        </div>

        <p className="text-xs text-slate-500">Example: Downy ₱20 / sachet, Liquid detergent ₱2 / ml, Hanger ₱10 / piece, Extra Rinse ₱30 / load, Extra Dry ₱40 / cycle, Stain Treatment ₱50 flat.</p>
        {notice && <InlineAlert variant={notice.type}>{notice.text}</InlineAlert>}
        <button type="submit" disabled={saving} className="inline-flex items-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-medium rounded-lg px-4 py-2 text-sm transition">{saving && <ButtonSpinner />}{saving ? 'Adding…' : 'Add to Catalog'}</button>
      </form>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div><h2 className="font-semibold text-slate-900 dark:text-slate-100">Add-ons Catalog</h2><p className="text-sm text-slate-500 mt-1">Active items appear on every open Staff transaction form automatically.</p></div>
          <button type="button" onClick={() => void reload()} disabled={loading} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">{loading ? 'Refreshing…' : '↻ Refresh'}</button>
        </div>

        {loadError && <InlineAlert variant="error" title="Add-ons could not be loaded" actionLabel="Try again" onAction={() => void reload()}>{loadError}</InlineAlert>}
        {!loadError && (realtimeState === 'disconnected' || realtimeState === 'error') && <InlineAlert variant="warning" title="Live add-on sync is temporarily offline" actionLabel="Refresh" onAction={() => void reload()}>Changes are still saved, but Staff screens may need a manual Refresh until Realtime reconnects.</InlineAlert>}

        {loading ? <LoadingPanel label="Loading add-ons…" slowLabel="Still loading add-ons… the internet connection may be slow." /> : addOns.length === 0 ? <EmptyState title="No add-ons yet" description="Add the first optional item above." /> : <div className="space-y-3">{addOns.map((item) => <AddOnRow key={item.id} item={item} onSaved={() => void reload()} />)}</div>}
      </div>
    </div>
  )
}

function AddOnRow({ item, onSaved }: { item: AddOn; onSaved: () => void }) {
  const [name, setName] = useState(item.name)
  const [price, setPrice] = useState(String(item.price))
  const [unitType, setUnitType] = useState<AddOnUnit>(item.unit_type)
  const [active, setActive] = useState(item.active)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => { setName(item.name); setPrice(String(item.price)); setUnitType(item.unit_type); setActive(item.active) }, [item])

  const save = async () => {
    const normalizedName = toTitleCaseName(name)
    const numericPrice = Number(price)
    if (!normalizedName || !Number.isFinite(numericPrice) || numericPrice < 0) return setNotice({ type: 'error', text: 'Check the name and price.' })

    setSaving(true); setNotice(null)
    const { error } = await supabase.from('add_ons_catalog').update({ name: normalizedName, price: numericPrice, unit_type: unitType, active }).eq('id', item.id)
    setSaving(false)
    if (error) return setNotice({ type: 'error', text: error.message })
    setNotice({ type: 'success', text: 'Saved. Staff add-ons sync automatically.' }); onSaved()
  }

  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_180px_auto] gap-3 items-end">
        <div><label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Name</label><input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></div>
        <div><label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Price (₱)</label><input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></div>
        <div><label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Unit</label><select value={unitType} onChange={(e) => setUnitType(e.target.value as AddOnUnit)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">{UNIT_OPTIONS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></div>
        <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-medium rounded-lg px-4 py-2 text-sm transition">{saving && <ButtonSpinner />}{saving ? 'Saving…' : 'Save'}</button>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap"><label className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Active on Staff form</label><span className="text-xs text-slate-500">Current: {peso(item.price)} / {item.unit_type}</span></div>
      {notice && <div className="mt-3"><InlineAlert variant={notice.type}>{notice.text}</InlineAlert></div>}
    </div>
  )
}
