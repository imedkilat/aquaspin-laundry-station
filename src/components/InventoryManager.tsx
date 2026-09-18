import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import type {
  InventoryCategory,
  InventoryItem,
  InventoryItemSummary,
  InventoryMovementType,
  InventoryStockMovement,
  InventoryUnit,
} from '../types/database'
import { ButtonSpinner, EmptyState, InlineAlert, LoadingPanel } from './UiFeedback'
import BentoCard from './BentoCard'
import UiIcon from './UiIcon'

const INPUT = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'
const UNITS: InventoryUnit[] = ['pcs', 'ml', 'L', 'g', 'kg']
const MOVEMENT_TYPES: Array<{ value: InventoryMovementType; label: string; hint: string }> = [
  { value: 'stock_in', label: 'Stock in', hint: 'Add newly purchased or received stock.' },
  { value: 'adjustment', label: 'Adjustment', hint: 'Correct the ledger with a positive or negative quantity.' },
  { value: 'consumption', label: 'Consumption', hint: 'Record stock used in daily operations. Use a negative quantity.' },
  { value: 'wastage', label: 'Wastage', hint: 'Record damaged or discarded stock. Use a negative quantity.' },
  { value: 'correction', label: 'Correction', hint: 'Record an audited correction with a clear reason.' },
]
const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dateTime = (value: string) => new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
type Notice = { type: 'error' | 'success'; text: string } | null

export default function InventoryManager() {
  const { profile } = useAuth()
  const [categories, setCategories] = useState<InventoryCategory[]>([])
  const [items, setItems] = useState<InventoryItem[]>([])
  const [summaries, setSummaries] = useState<InventoryItemSummary[]>([])
  const [movements, setMovements] = useState<InventoryStockMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [categoryName, setCategoryName] = useState('')
  const [categorySaving, setCategorySaving] = useState(false)
  const [itemName, setItemName] = useState('')
  const [itemCategoryId, setItemCategoryId] = useState('')
  const [itemUnit, setItemUnit] = useState<InventoryUnit>('pcs')
  const [itemThreshold, setItemThreshold] = useState('0')
  const [itemCost, setItemCost] = useState('0')
  const [itemNotes, setItemNotes] = useState('')
  const [itemSaving, setItemSaving] = useState(false)

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true)
    else setLoading(true)
    setError(null)

    const [categoryResult, itemResult, summaryResult, movementResult] = await Promise.all([
      supabase.from('inventory_categories').select('*').order('name'),
      supabase.from('inventory_items').select('*').order('item_name'),
      supabase.from('inventory_item_summary').select('*').order('item_name'),
      supabase.from('inventory_stock_movements').select('*').order('created_at', { ascending: false }).limit(30),
    ])
    const firstError = [categoryResult.error, itemResult.error, summaryResult.error, movementResult.error].find(Boolean)

    if (firstError) setError(firstError.message)
    else {
      setCategories(categoryResult.data ?? [])
      setItems(itemResult.data ?? [])
      setSummaries(summaryResult.data ?? [])
      setMovements(movementResult.data ?? [])
    }

    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const addCategory = async (event: FormEvent) => {
    event.preventDefault()
    setNotice(null)
    const normalizedName = categoryName.trim()
    if (!normalizedName) return setNotice({ type: 'error', text: 'Category name is required.' })
    if (!profile?.id) return setNotice({ type: 'error', text: 'Your profile is not ready yet. Please try again.' })

    setCategorySaving(true)
    const { error: saveError } = await supabase.from('inventory_categories').insert({
      name: normalizedName,
      active: true,
      created_by: profile.id,
    })
    setCategorySaving(false)

    if (saveError) {
      setNotice({ type: 'error', text: saveError.message.toLowerCase().includes('inventory_categories_name_unique_idx') ? 'That category already exists.' : saveError.message })
      return
    }

    setCategoryName('')
    setNotice({ type: 'success', text: `${normalizedName} added.` })
    void load(true)
  }

  const addItem = async (event: FormEvent) => {
    event.preventDefault()
    setNotice(null)
    const normalizedName = itemName.trim()
    const threshold = Number(itemThreshold)
    const averageCost = Number(itemCost)

    if (!normalizedName) return setNotice({ type: 'error', text: 'Item name is required.' })
    if (!Number.isFinite(threshold) || threshold < 0) return setNotice({ type: 'error', text: 'Reorder threshold must be zero or greater.' })
    if (!Number.isFinite(averageCost) || averageCost < 0) return setNotice({ type: 'error', text: 'Average cost must be zero or greater.' })
    if (!profile?.id) return setNotice({ type: 'error', text: 'Your profile is not ready yet. Please try again.' })

    setItemSaving(true)
    const { error: saveError } = await supabase.from('inventory_items').insert({
      item_name: normalizedName,
      category_id: itemCategoryId || null,
      unit_label: itemUnit,
      reorder_threshold: threshold,
      average_cost: averageCost,
      notes: itemNotes.trim() || null,
      active: true,
      created_by: profile.id,
    })
    setItemSaving(false)

    if (saveError) {
      setNotice({ type: 'error', text: saveError.message })
      return
    }

    setItemName('')
    setItemCategoryId('')
    setItemUnit('pcs')
    setItemThreshold('0')
    setItemCost('0')
    setItemNotes('')
    setNotice({ type: 'success', text: `${normalizedName} added to inventory.` })
    void load(true)
  }

  const summaryMap = useMemo(() => new Map(summaries.map((summary) => [summary.id, summary])), [summaries])
  const itemNameMap = useMemo(() => new Map(items.map((item) => [item.id, item.item_name])), [items])
  const lowStockCount = summaries.filter((summary) => summary.reorder_threshold > 0 && summary.current_quantity <= summary.reorder_threshold && summary.active).length
  const totalStockValue = summaries.reduce((total, summary) => total + Number(summary.stock_value || 0), 0)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-sky-600">Phase 3 · Inventory</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">Inventory & Consumables</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">Set up supplies and record every stock movement. Balances come from the append-only ledger, not manually editable quantity fields.</p>
        </div>
        <button type="button" onClick={() => void load(true)} disabled={loading || refreshing} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><UiIcon name="refresh" size={16} />{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {error && <InlineAlert variant="error" title="Inventory could not be refreshed" actionLabel="Try again" onAction={() => void load()}>{error} Existing loaded rows remain visible.</InlineAlert>}
      {notice && <InlineAlert variant={notice.type}>{notice.text}</InlineAlert>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Metric label="Active items" value={String(items.filter((item) => item.active).length)} hint={`${items.length} total configured`} icon="box" />
        <Metric label="Low stock" value={String(lowStockCount)} hint="Active items at or below threshold" icon="alert" warning={lowStockCount > 0} />
        <Metric label="Stock value" value={peso(totalStockValue)} hint="Based on average cost × ledger balance" icon="money" />
      </div>

      {lowStockCount > 0 && <BentoCard title={`${lowStockCount} item${lowStockCount === 1 ? '' : 's'} need restocking`} description="Review the highlighted items and record stock in from their movement controls." icon="alert" tone="amber" action={<button type="button" onClick={() => document.getElementById('inventory-items')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="inline-flex items-center gap-2 rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950/60"><UiIcon name="box" size={16} />Review items</button>}>
        <p className="text-sm text-amber-800 dark:text-amber-200">Low-stock balances are calculated from the inventory ledger and remain visible until replenished.</p>
      </BentoCard>}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <form onSubmit={addCategory} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
          <div><h2 className="font-semibold text-slate-900 dark:text-slate-100">Inventory Categories</h2><p className="mt-1 text-sm text-slate-500">Group supplies such as detergent, packaging, and cleaning materials.</p></div>
          <div className="flex gap-2">
            <input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Detergent" maxLength={80} className={INPUT} />
            <button type="submit" disabled={categorySaving} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60">{categorySaving && <ButtonSpinner />}{categorySaving ? 'Adding…' : 'Add category'}</button>
          </div>
          {categories.length === 0 ? <p className="text-sm text-slate-500">No categories yet.</p> : <div className="space-y-2">{categories.map((category) => <CategoryRow key={category.id} category={category} onSaved={() => void load(true)} />)}</div>}
        </form>

        <form onSubmit={addItem} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
          <div><h2 className="font-semibold text-slate-900 dark:text-slate-100">Add Inventory Item</h2><p className="mt-1 text-sm text-slate-500">Configure a supply before recording stock in or consumption.</p></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Item name"><input required value={itemName} onChange={(event) => setItemName(event.target.value)} placeholder="Detergent sachet" maxLength={120} className={INPUT} /></Field>
            <Field label="Category"><select value={itemCategoryId} onChange={(event) => setItemCategoryId(event.target.value)} className={INPUT}><option value="">Uncategorized</option>{categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
            <Field label="Unit"><select value={itemUnit} onChange={(event) => setItemUnit(event.target.value as InventoryUnit)} className={INPUT}>{UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></Field>
            <Field label="Reorder threshold"><input required type="number" min="0" step="0.001" value={itemThreshold} onChange={(event) => setItemThreshold(event.target.value)} className={INPUT} /></Field>
            <Field label="Average cost (₱)"><input required type="number" min="0" step="0.01" value={itemCost} onChange={(event) => setItemCost(event.target.value)} className={INPUT} /></Field>
            <Field label="Notes"><input value={itemNotes} onChange={(event) => setItemNotes(event.target.value)} maxLength={500} placeholder="Optional" className={INPUT} /></Field>
          </div>
          <button type="submit" disabled={itemSaving} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60">{itemSaving && <ButtonSpinner />}{itemSaving ? 'Adding…' : 'Add item'}</button>
        </form>
      </div>

      <section id="inventory-items" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-900">
        <div><h2 className="font-semibold text-slate-900 dark:text-slate-100">Inventory Items</h2><p className="mt-1 text-sm text-slate-500">Edit item settings or record a stock movement. Quantity is always calculated from the ledger.</p></div>
        {loading ? <LoadingPanel label="Loading inventory…" slowLabel="Still loading inventory… the connection may be slow." /> : items.length === 0 ? <EmptyState title="No inventory items yet" description="Add a category and item above to start tracking supplies." /> : <div className="space-y-3">{items.map((item) => <InventoryItemRow key={item.id} item={item} summary={summaryMap.get(item.id)} categories={categories} onSaved={() => void load(true)} />)}</div>}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
        <div><h2 className="font-semibold text-slate-900 dark:text-slate-100">Recent Stock Movement Ledger</h2><p className="mt-1 text-sm text-slate-500">Movement rows are append-only. Corrections should include a clear explanation.</p></div>
        {movements.length === 0 ? <EmptyState title="No movements yet" description="Record stock in, consumption, wastage, or an adjustment from an item above." /> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead><tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700"><th className="py-2 pr-4">Date</th><th className="py-2 pr-4">Item</th><th className="py-2 pr-4">Type</th><th className="py-2 pr-4">Quantity</th><th className="py-2 pr-4">Reason</th><th className="py-2">Unit cost</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800"><td className="py-2 pr-4 whitespace-nowrap text-slate-500">{dateTime(movement.created_at)}</td><td className="py-2 pr-4">{itemNameMap.get(movement.item_id) ?? 'Unknown item'}</td><td className="py-2 pr-4 capitalize">{movement.movement_type.replace('_', ' ')}</td><td className={`py-2 pr-4 font-medium ${movement.quantity_delta < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{movement.quantity_delta > 0 ? '+' : ''}{movement.quantity_delta}</td><td className="max-w-xs py-2 pr-4 text-slate-500">{movement.reason}</td><td className="py-2">{movement.unit_cost == null ? '—' : peso(movement.unit_cost)}</td></tr>)}</tbody></table></div>}
      </section>
    </div>
  )
}

function CategoryRow({ category, onSaved }: { category: InventoryCategory; onSaved: () => void }) {
  const [active, setActive] = useState(category.active)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => { setActive(category.active) }, [category.active])

  const save = async () => {
    setSaving(true)
    setNotice(null)
    const { error } = await supabase.from('inventory_categories').update({ active }).eq('id', category.id)
    setSaving(false)
    if (error) return setNotice({ type: 'error', text: error.message })
    setNotice({ type: 'success', text: 'Category status saved.' })
    onSaved()
  }

  return <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700"><div><p className="font-medium text-slate-800 dark:text-slate-200">{category.name}</p><p className="text-xs text-slate-500">{category.active ? 'Active' : 'Inactive'}</p></div><div className="flex items-center gap-2"><select value={active ? 'active' : 'inactive'} onChange={(event) => setActive(event.target.value === 'active')} disabled={saving} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950"><option value="active">Active</option><option value="inactive">Inactive</option></select><button type="button" onClick={() => void save()} disabled={saving || active === category.active} className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">{saving ? 'Saving…' : 'Save'}</button></div>{notice && <span className="text-xs text-rose-600">{notice.text}</span>}</div>
}

function InventoryItemRow({ item, summary, categories, onSaved }: { item: InventoryItem; summary?: InventoryItemSummary; categories: InventoryCategory[]; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [movementOpen, setMovementOpen] = useState(false)
  const [name, setName] = useState(item.item_name)
  const [categoryId, setCategoryId] = useState(item.category_id ?? '')
  const [unit, setUnit] = useState<InventoryUnit>(item.unit_label)
  const [threshold, setThreshold] = useState(String(item.reorder_threshold))
  const [cost, setCost] = useState(String(item.average_cost))
  const [notes, setNotes] = useState(item.notes ?? '')
  const [active, setActive] = useState(item.active)
  const [movementType, setMovementType] = useState<InventoryMovementType>('stock_in')
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => {
    setName(item.item_name)
    setCategoryId(item.category_id ?? '')
    setUnit(item.unit_label)
    setThreshold(String(item.reorder_threshold))
    setCost(String(item.average_cost))
    setNotes(item.notes ?? '')
    setActive(item.active)
  }, [item])

  const save = async () => {
    const normalizedName = name.trim()
    const nextThreshold = Number(threshold)
    const nextCost = Number(cost)
    if (!normalizedName) return setNotice({ type: 'error', text: 'Item name is required.' })
    if (!Number.isFinite(nextThreshold) || nextThreshold < 0) return setNotice({ type: 'error', text: 'Reorder threshold must be zero or greater.' })
    if (!Number.isFinite(nextCost) || nextCost < 0) return setNotice({ type: 'error', text: 'Average cost must be zero or greater.' })

    setSaving(true)
    setNotice(null)
    const { error } = await supabase.from('inventory_items').update({
      item_name: normalizedName,
      category_id: categoryId || null,
      unit_label: unit,
      reorder_threshold: nextThreshold,
      average_cost: nextCost,
      notes: notes.trim() || null,
      active,
    }).eq('id', item.id)
    setSaving(false)
    if (error) return setNotice({ type: 'error', text: error.message })
    setEditing(false)
    setNotice({ type: 'success', text: 'Inventory item saved.' })
    onSaved()
  }

  const deletePermanently = async () => {
    if (!window.confirm(`Permanently delete ${item.item_name}? This cannot be undone.`)) return

    setSaving(true)
    setNotice(null)
    const { error } = await supabase.from('inventory_items').delete().eq('id', item.id)
    setSaving(false)

    if (error) {
      const foreignKeyBlocked = error.code === '23503' || error.message.toLowerCase().includes('foreign key')
      setNotice({
        type: 'error',
        text: foreignKeyBlocked
          ? 'This item has stock or transaction history and cannot be permanently deleted. Set it inactive instead.'
          : error.message,
      })
      return
    }

    setEditing(false)
    onSaved()
  }

  const recordMovement = async () => {
    const nextQuantity = Number(quantity)
    const nextUnitCost = unitCost.trim() ? Number(unitCost) : null
    if (!Number.isFinite(nextQuantity) || nextQuantity === 0) return setNotice({ type: 'error', text: 'Quantity must be a non-zero number.' })
    if (nextUnitCost != null && (!Number.isFinite(nextUnitCost) || nextUnitCost < 0)) return setNotice({ type: 'error', text: 'Unit cost must be zero or greater.' })
    if (!reason.trim()) return setNotice({ type: 'error', text: 'A movement reason is required.' })
    if (movementType === 'stock_in' && nextQuantity <= 0) return setNotice({ type: 'error', text: 'Stock in quantity must be positive.' })
    if (movementType === 'consumption' && nextQuantity >= 0) return setNotice({ type: 'error', text: 'Consumption quantity must be negative.' })
    if (movementType === 'wastage' && nextQuantity >= 0) return setNotice({ type: 'error', text: 'Wastage quantity must be negative.' })

    setSaving(true)
    setNotice(null)
    const { error } = await supabase.rpc('record_inventory_movement', {
      p_item_id: item.id,
      p_movement_type: movementType,
      p_quantity_delta: nextQuantity,
      p_reason: reason.trim(),
      p_unit_cost: nextUnitCost,
    })
    setSaving(false)
    if (error) return setNotice({ type: 'error', text: error.message })
    setQuantity('')
    setUnitCost('')
    setReason('')
    setMovementOpen(false)
    setNotice({ type: 'success', text: 'Stock movement recorded.' })
    onSaved()
  }

  const currentQuantity = Number(summary?.current_quantity ?? 0)
  const stockValue = Number(summary?.stock_value ?? 0)
  const lowStock = item.active && Number(item.reorder_threshold) > 0 && currentQuantity <= Number(item.reorder_threshold)

  return (
    <div className={`rounded-xl border p-4 ${lowStock ? 'border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-700'}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-slate-900 dark:text-slate-100">{item.item_name}</p><span className={item.active ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400'}>{item.active ? 'Active' : 'Inactive'}</span>{lowStock && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">Low stock</span>}</div><p className="mt-1 text-xs text-slate-500">{summary?.category_name ?? 'Uncategorized'} · {item.unit_label} · {peso(stockValue)} stock value</p></div>
        <div className="flex flex-wrap items-center gap-2"><div className="rounded-lg bg-slate-50 px-3 py-2 text-right dark:bg-slate-950"><p className="text-[11px] text-slate-500">Balance</p><p className="font-semibold text-slate-900 dark:text-slate-100">{currentQuantity} {item.unit_label}</p></div><button type="button" onClick={() => { setMovementOpen((open) => !open); setNotice(null) }} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"><UiIcon name="box" size={16} />{movementOpen ? 'Close movement' : 'Record movement'}</button><button type="button" onClick={() => { setEditing((open) => !open); setNotice(null) }} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><UiIcon name="settings" size={16} />{editing ? 'Close edit' : 'Edit item'}</button></div>
      </div>

      {editing && <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-950"><Field label="Item name"><input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className={INPUT} /></Field><Field label="Category"><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={INPUT}><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.active ? '' : ' (inactive)'}</option>)}</select></Field><Field label="Unit"><select value={unit} onChange={(event) => setUnit(event.target.value as InventoryUnit)} className={INPUT}>{UNITS.map((value) => <option key={value} value={value}>{value}</option>)}</select></Field><Field label="Reorder threshold"><input type="number" min="0" step="0.001" value={threshold} onChange={(event) => setThreshold(event.target.value)} className={INPUT} /></Field><Field label="Average cost (₱)"><input type="number" min="0" step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} className={INPUT} /></Field><Field label="Notes"><input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} className={INPUT} /></Field><label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />Active item</label><div className="sm:col-span-2 lg:col-span-2 flex flex-wrap items-center gap-2"><button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60">{saving && <ButtonSpinner />}{saving ? 'Saving…' : 'Save item'}</button><button type="button" onClick={() => void deletePermanently()} disabled={saving} className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30">Delete permanently</button></div></div>}

      {movementOpen && <div className="mt-4 rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/20"><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"><Field label="Movement type"><select value={movementType} onChange={(event) => setMovementType(event.target.value as InventoryMovementType)} className={INPUT}>{MOVEMENT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><Field label="Quantity"><input type="number" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder={movementType === 'stock_in' ? '10' : '-1'} className={INPUT} /></Field><Field label="Unit cost (₱)"><input type="number" min="0" step="0.01" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} placeholder="Optional" className={INPUT} /></Field><Field label="Reason"><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder={MOVEMENT_TYPES.find((option) => option.value === movementType)?.hint} className={INPUT} /></Field></div><div className="mt-3 flex items-center justify-between gap-3 flex-wrap"><p className="text-xs text-emerald-800 dark:text-emerald-200">{MOVEMENT_TYPES.find((option) => option.value === movementType)?.hint}</p><button type="button" onClick={() => void recordMovement()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">{saving && <ButtonSpinner />}{saving ? 'Recording…' : 'Record movement'}</button></div></div>}

      {notice && <div className="mt-3"><InlineAlert variant={notice.type}>{notice.text}</InlineAlert></div>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">{label}<span className="mt-1 block">{children}</span></label>
}

function Metric({ label, value, hint, icon, warning = false }: { label: string; value: string; hint: string; icon: 'box' | 'alert' | 'money'; warning?: boolean }) {
  return <div className={`rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:bg-slate-900 ${warning ? 'border-amber-200 dark:border-amber-900' : 'border-slate-200 dark:border-slate-800'}`}><span className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${warning ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}><UiIcon name={icon} size={18} /></span><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 text-2xl font-semibold ${warning ? 'text-amber-700 dark:text-amber-300' : 'text-slate-900 dark:text-slate-100'}`}>{value}</p><p className="mt-1 text-xs text-slate-400">{hint}</p></div>
}
