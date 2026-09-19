import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import BentoCard from '../components/BentoCard'
import CustomerItemsPendingCard from '../components/CustomerItemsPendingCard'
import OnHoldHomeCard from '../components/OnHoldHomeCard'
import PaymentBadge from '../components/PaymentBadge'
import UiIcon, { type IconName } from '../components/UiIcon'
import { ButtonSpinner, InlineAlert, LoadingPanel } from '../components/UiFeedback'
import { useShopDate } from '../hooks/useShopDate'
import { useTransactions } from '../hooks/useTransactions'
import { useOnHoldTransactions } from '../hooks/useOnHoldTransactions'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import { useShopSettings } from '../lib/shop-settings-context'
import { calculateSalesMetrics } from '../lib/sales-metrics'
import { canEditCustomerItems, isCustomerItemsPending, PENDING_CUSTOMER_ITEM_STATUSES } from '../lib/customer-items-pending'
import type { InventoryItemSummary } from '../types/database'

const peso = (value: number) =>
  `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function HomePage() {
  const { profile } = useAuth()
  const { settings } = useShopSettings()
  const today = useShopDate()
  const isOwner = profile?.role === 'owner'
  const monthStart = `${today.slice(0, 8)}01`
  const { rows, loading, error, realtimeState, reload: reloadActivity } = useTransactions({
    dateFrom: isOwner ? monthStart : today,
    dateTo: today,
    limit: 500,
    fetchAll: true,
  })
  const { rows: outstandingRows, loading: outstandingLoading, error: outstandingError, realtimeState: outstandingRealtimeState, reload: reloadOutstanding } = useTransactions({
    dateTo: today,
    limit: 500,
    fetchAll: true,
    paymentMethod: 'pay_later',
  })
  const {
    rows: pendingCoverageRows,
    loading: pendingLoading,
    error: pendingError,
    realtimeState: pendingRealtimeState,
    reload: reloadPending,
  } = useTransactions({
    dateTo: today,
    limit: 1000,
    fetchAll: true,
    orderStatuses: PENDING_CUSTOMER_ITEM_STATUSES,
    includeCustomerItemCoverage: true,
  })
  const {
    rows: onHoldRows,
    loading: onHoldLoading,
    error: onHoldError,
    realtimeState: onHoldRealtimeState,
    reload: reloadOnHold,
  } = useOnHoldTransactions()

  const pendingRows = useMemo(
    () => pendingCoverageRows.filter(isCustomerItemsPending),
    [pendingCoverageRows],
  )

  const reload = useCallback(() => {
    void reloadActivity()
    void reloadOutstanding()
    void reloadPending()
    void reloadOnHold()
  }, [reloadActivity, reloadOnHold, reloadOutstanding, reloadPending])

  const stats = useMemo(() => {
    const periodMetrics = calculateSalesMetrics(rows, today, monthStart)
    const outstandingMetrics = calculateSalesMetrics(outstandingRows, today, monthStart)
    const recent = rows
      .filter((row) => row.transaction_date === today && row.deleted_at == null && row.order_status !== 'cancelled' && Number.isFinite(Number(row.total_amount)) && Number(row.total_amount) >= 0)
      .slice(0, 5)
    return {
      sales: periodMetrics.todaySales,
      monthlySales: periodMetrics.monthlySales,
      cashCollected: periodMetrics.cashCollected,
      kg: periodMetrics.todayWeight,
      orders: periodMetrics.todayOrders,
      outstandingPayLater: outstandingMetrics.outstandingPayLater,
      recent,
    }
  }, [monthStart, outstandingRows, rows, today])

  const combinedError = error || outstandingError || pendingError || onHoldError
  const realtimeOffline = [realtimeState, outstandingRealtimeState, pendingRealtimeState, onHoldRealtimeState].some((state) => state === 'disconnected' || state === 'error')

  if ((loading || outstandingLoading || pendingLoading || onHoldLoading) && rows.length === 0 && outstandingRows.length === 0 && pendingCoverageRows.length === 0 && onHoldRows.length === 0) {
    return <LoadingPanel label="Opening today's shop view…" slowLabel="Still loading today's laundry activity…" />
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1.35fr_.65fr]">
        <section className="rounded-2xl border border-sky-700 bg-sky-600 p-5 text-white shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-sky-100">{today}</p>
              <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Good day, {profile?.full_name?.split(' ')[0] || 'Aquaspin'}.</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-sky-100">Run today's laundry operations from one place. Add orders, check balances, and review recent activity.</p>
            </div>
            <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white sm:flex"><UiIcon name="home" size={24} /></span>
          </div>
          <Link to="/new" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-sky-700 shadow-sm transition hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-sky-600">
            <UiIcon name="plus" size={18} /> New Order <UiIcon name="arrow-right" size={16} />
          </Link>
        </section>

        <BentoCard title="Quick actions" description="Common operational shortcuts" icon="dashboard" tone="violet" className="flex flex-col justify-between">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <QuickAction to="/orders" title="Orders" description="Search and review" icon="orders" />
            {isOwner ? <QuickAction to="/dashboard" title="Dashboard" description="Reports and controls" icon="dashboard" /> : <QuickAction to="/profile" title="My Profile" description="Review account details" icon="profile" />}
          </div>
        </BentoCard>
      </div>

      <div className="space-y-2">
        {combinedError && (
          <InlineAlert variant="error" title="Today's activity could not be refreshed" actionLabel="Try again" onAction={() => void reload()}>
            {combinedError} Existing figures remain visible until the refresh succeeds.
          </InlineAlert>
        )}
        {!combinedError && realtimeOffline && (
          <InlineAlert variant="warning" title="Live sync is temporarily offline" actionLabel="Refresh now" onAction={() => void reload()}>
            Aquaspin is still usable, but changes from another browser may take longer to appear.
          </InlineAlert>
        )}
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
        <MetricCard label="Today's Sales" value={peso(stats.sales)} hint={`${stats.orders} orders`} icon="money" />
        {isOwner && <MetricCard label="Monthly Sales" value={peso(stats.monthlySales)} hint={`Since ${monthStart}`} icon="calendar" />}
        <MetricCard label="Cash Collected" value={peso(stats.cashCollected)} hint={isOwner ? `Since ${monthStart}` : "Today's paid orders"} icon="money" tone="success" />
        <MetricCard label="Laundry Weight" value={`${stats.kg.toFixed(stats.kg % 1 === 0 ? 0 : 1)} kg`} hint="Processed today" icon="wash" />
        <MetricCard label="Orders" value={String(stats.orders)} hint="Active transactions" icon="orders" />
        <MetricCard label="Outstanding Pay Later" value={peso(stats.outstandingPayLater)} hint={isOwner ? `Since ${monthStart}` : "Today's receivables"} icon="alert" tone={stats.outstandingPayLater > 0 ? 'warning' : 'default'} />
      </section>

      <CustomerItemsPendingCard
        rows={pendingRows}
        loading={pendingLoading}
        error={pendingError}
        canEdit={canEditCustomerItems(profile?.role, settings.staff_can_edit_transactions)}
        onRefresh={() => void reloadPending()}
      />

      <OnHoldHomeCard
        rows={onHoldRows}
        loading={onHoldLoading}
        error={onHoldError}
        onRefresh={() => void reloadOnHold()}
      />

      {isOwner && <LowStockInventory />}

      <BentoCard title="Recent Orders" description="Latest transactions recorded today" icon="orders" action={<Link to="/orders" className="inline-flex items-center gap-1 text-sm font-semibold text-sky-600 hover:text-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-sky-400"><span>View all</span><UiIcon name="arrow-right" size={16} /></Link>}>

        {stats.recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No orders yet today. Create the first one when a customer arrives.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {stats.recent.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{row.customer_name}</p>
                    <span className="text-xs text-slate-400">{row.transaction_code}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {row.services?.label || row.services?.code || 'Laundry service'}{row.kg != null ? ` · ${row.kg} kg` : ''}{row.no_of_loads != null ? ` · ${row.no_of_loads} load${row.no_of_loads === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <PaymentBadge method={row.payment_method} />
                  <p className="min-w-20 text-right font-semibold text-slate-900 dark:text-slate-100">{peso(row.total_amount)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </BentoCard>
    </div>
  )
}

type InventoryNotice = { type: 'error' | 'success'; text: string } | null

function LowStockInventory() {
  const [items, setItems] = useState<InventoryItemSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<InventoryNotice>(null)
  const [restockItem, setRestockItem] = useState<InventoryItemSummary | null>(null)
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [reason, setReason] = useState('Restock')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: loadError } = await supabase
      .from('inventory_item_summary')
      .select('*')
      .eq('active', true)
      .order('current_quantity', { ascending: true })
      .order('item_name')

    if (loadError) {
      setError(loadError.message)
      setItems([])
    } else {
      const lowStock = ((data ?? []) as InventoryItemSummary[]).filter(
        (item) => Number(item.reorder_threshold) > 0 && Number(item.current_quantity) <= Number(item.reorder_threshold),
      )
      setItems(lowStock)
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openRestock = (item: InventoryItemSummary) => {
    setNotice(null)
    setRestockItem(item)
    setQuantity('')
    setUnitCost('')
    setReason('Restock')
  }

  const closeRestock = () => {
    if (saving) return
    setRestockItem(null)
    setQuantity('')
    setUnitCost('')
    setReason('Restock')
  }

  const recordRestock = async () => {
    if (!restockItem) return

    const nextQuantity = Number(quantity)
    const nextUnitCost = unitCost.trim() ? Number(unitCost) : null
    const nextReason = reason.trim()

    if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
      setNotice({ type: 'error', text: 'Restock quantity must be greater than zero.' })
      return
    }
    if (nextUnitCost != null && (!Number.isFinite(nextUnitCost) || nextUnitCost < 0)) {
      setNotice({ type: 'error', text: 'Unit cost must be zero or greater.' })
      return
    }
    if (!nextReason) {
      setNotice({ type: 'error', text: 'A restock reason is required.' })
      return
    }

    setSaving(true)
    setNotice(null)

    const { error: saveError } = await supabase.rpc('record_inventory_movement', {
      p_item_id: restockItem.id,
      p_movement_type: 'stock_in',
      p_quantity_delta: nextQuantity,
      p_reason: nextReason,
      p_unit_cost: nextUnitCost,
    })

    setSaving(false)

    if (saveError) {
      setNotice({ type: 'error', text: saveError.message })
      return
    }

    const itemName = restockItem.item_name
    closeRestock()
    setNotice({ type: 'success', text: `${itemName} restock recorded successfully.` })
    await load()
  }

  const quantityText = (value: number) => {
    const normalized = Number(value)
    return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(3).replace(/\.?0+$/, '')
  }

  // Do not add an empty warning block to Owners Home. Keep the block visible
  // only when there are low-stock items or when the inventory check failed.
  if (items.length === 0 && !error) return null

  return (
    <>
      <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-amber-900/70 dark:bg-amber-950/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-amber-950 dark:text-amber-100">Low Stock Inventory</h2>
              {items.length > 0 && <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900 dark:text-amber-100">{items.length}</span>}
            </div>
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">Items at or below their reorder threshold need attention.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-950/50">
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>

        {error && <div className="mt-4"><InlineAlert variant="error" title="Low stock could not be refreshed" actionLabel="Try again" onAction={() => void load()}>{error}</InlineAlert></div>}
        {notice && <div className="mt-4"><InlineAlert variant={notice.type}>{notice.text}</InlineAlert></div>}

        {loading ? (
          <div className="mt-4"><LoadingPanel compact label="Checking inventory balances…" slowLabel="Still checking inventory balances…" /></div>
        ) : error ? null : items.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-amber-300 px-4 py-5 text-center text-sm text-amber-800 dark:border-amber-800 dark:text-amber-200">All active inventory items are sufficiently stocked.</div>
        ) : (
          <div className="mt-4 space-y-2">
            {items.map((item) => {
              const current = Number(item.current_quantity)
              const outOfStock = current <= 0
              return (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white/80 px-4 py-3 dark:border-amber-900/60 dark:bg-slate-900/70">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{item.item_name}</p>
                      <span className={outOfStock ? 'rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-300' : 'rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300'}>{outOfStock ? 'Out of stock' : 'Low stock'}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.category_name || 'Uncategorized'} · {quantityText(current)} {item.unit_label} remaining · reorder at {quantityText(Number(item.reorder_threshold))} {item.unit_label}</p>
                  </div>
                  <button type="button" onClick={() => openRestock(item)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">Restock</button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {restockItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="restock-title">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">Inventory restock</p>
                <h2 id="restock-title" className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{restockItem.item_name}</h2>
                <p className="mt-1 text-sm text-slate-500">Current balance: {quantityText(Number(restockItem.current_quantity))} {restockItem.unit_label}</p>
              </div>
              <button type="button" onClick={closeRestock} disabled={saving} className="text-2xl leading-none text-slate-400 hover:text-slate-600 disabled:opacity-50" aria-label="Close restock dialog">×</button>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Quantity to add *<input autoFocus required type="number" min="0.001" step={restockItem.unit_label === 'pcs' ? '1' : '0.001'} value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="Enter quantity" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></label>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Unit cost (₱)<input type="number" min="0" step="0.01" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} placeholder="Optional" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></label>
            </div>

            <label className="mt-4 block text-xs font-medium text-slate-600 dark:text-slate-400">Reason *<input required value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></label>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={closeRestock} disabled={saving} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
              <button type="button" onClick={() => void recordRestock()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{saving && <ButtonSpinner />}{saving ? 'Recording…' : 'Record Restock'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function MetricCard({ label, value, hint, icon, tone = 'default' }: { label: string; value: string; hint: string; icon: IconName; tone?: 'default' | 'warning' | 'success' }) {
  return (
    <div className={`rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:bg-slate-900 ${tone === 'warning' ? 'border-amber-200 dark:border-amber-900' : tone === 'success' ? 'border-emerald-200 dark:border-emerald-900' : 'border-slate-200 dark:border-slate-800'}`}>
      <div className="flex items-center justify-between gap-3"><p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone === 'warning' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : tone === 'success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300'}`}><UiIcon name={icon} size={17} /></span></div>
      <p className={`mt-3 text-xl font-semibold sm:text-2xl ${tone === 'warning' ? 'text-amber-700 dark:text-amber-300' : tone === 'success' ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-900 dark:text-slate-100'}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-400">{hint}</p>
    </div>
  )
}

function QuickAction({ to, title, description, icon }: { to: string; title: string; description: string; icon: IconName }) {
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-sky-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-800">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700 transition group-hover:bg-sky-100 dark:bg-sky-950 dark:text-sky-300"><UiIcon name={icon} size={18} /></span>
      <span className="min-w-0">
        <span className="block font-medium text-slate-900 dark:text-slate-100">{title}</span>
        <span className="block text-xs text-slate-500 dark:text-slate-400">{description}</span>
      </span>
      <UiIcon name="arrow-right" size={16} className="ml-auto text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-sky-600" />
    </Link>
  )
}
