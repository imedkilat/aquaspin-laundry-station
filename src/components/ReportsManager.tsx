import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import { shopDate } from '../lib/date'
import type { ActiveExpense, InventoryItemSummary, InventoryStockMovement, Transaction } from '../types/database'
import { EmptyState, InlineAlert, LoadingPanel } from './UiFeedback'

type ReportTab = 'sales' | 'expenses' | 'inventory'
type Preset = 'today' | 'week' | 'month' | 'custom'
const peso = (value: number) => '₱' + value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const shiftShopDate = (value: string, days: number) => {
  const date = new Date(value + 'T00:00:00Z')
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
const manilaStartUtc = (value: string) => new Date(value + 'T00:00:00+08:00').toISOString()
const getPeriod = (preset: Preset, today: string, customFrom: string, customTo: string) => {
  if (preset === 'today') return { from: today, to: today }
  if (preset === 'month') return { from: today.slice(0, 8) + '01', to: today }
  if (preset === 'week') {
    const weekday = new Date(today + 'T00:00:00Z').getUTCDay()
    const daysFromMonday = (weekday + 6) % 7
    return { from: shiftShopDate(today, -daysFromMonday), to: today }
  }
  return { from: customFrom, to: customTo }
}

export default function ReportsManager() {
  const { profile } = useAuth()
  const today = shopDate()
  const [tab, setTab] = useState<ReportTab>('sales')
  const [preset, setPreset] = useState<Preset>('month')
  const [dateFrom, setDateFrom] = useState(today.slice(0, 8) + '01')
  const [dateTo, setDateTo] = useState(today)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [expenses, setExpenses] = useState<ActiveExpense[]>([])
  const [inventory, setInventory] = useState<InventoryItemSummary[]>([])
  const [movements, setMovements] = useState<InventoryStockMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const period = useMemo(() => getPeriod(preset, today, dateFrom, dateTo), [preset, today, dateFrom, dateTo])

  const load = useCallback(async (quiet = false) => {
    if (!period.from || !period.to || period.from > period.to) {
      setError('Report start date must be on or before the end date.')
      return
    }
    if (quiet) setRefreshing(true)
    else setLoading(true)
    setError(null)

    const [transactionResult, expenseResult, inventoryResult, movementResult] = await Promise.all([
      supabase.from('transactions').select('*').gte('transaction_date', period.from).lte('transaction_date', period.to).is('deleted_at', null).order('transaction_date', { ascending: false }),
      supabase.from('active_expenses').select('*').gte('expense_date', period.from).lte('expense_date', period.to).order('expense_date', { ascending: false }),
      supabase.from('inventory_item_summary').select('*').order('item_name'),
      supabase.from('inventory_stock_movements').select('*').gte('created_at', manilaStartUtc(period.from)).lte('created_at', manilaStartUtc(shiftShopDate(period.to, 1))).order('created_at', { ascending: false }),
    ])
    const firstError = [transactionResult.error, expenseResult.error, inventoryResult.error, movementResult.error].find(Boolean)

    if (firstError) {
      setError(firstError.message)
    } else {
      setTransactions(transactionResult.data ?? [])
      setExpenses(expenseResult.data ?? [])
      setInventory(inventoryResult.data ?? [])
      setMovements(movementResult.data ?? [])
    }

    setLoading(false)
    setRefreshing(false)
  }, [period.from, period.to])

  useEffect(() => { void load() }, [load])

  const salesRows = useMemo(() => transactions.filter((transaction) => transaction.order_status !== 'cancelled'), [transactions])
  const cancelledCount = transactions.length - salesRows.length
  const sales = useMemo(() => {
    const total = salesRows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0)
    const paidRows = salesRows.filter((row) => row.payment_method !== 'pay_later')
    const unpaidRows = salesRows.filter((row) => row.payment_method === 'pay_later')
    const serviceTotals = new Map<string, number>()
    const paymentTotals = new Map<string, number>()
    let addOnTotal = 0
    let kgTotal = 0

    for (const row of salesRows) {
      const service = row.service_label_snapshot || 'Unknown service'
      serviceTotals.set(service, (serviceTotals.get(service) ?? 0) + Number(row.base_amount || 0))
      addOnTotal += Number(row.add_ons || 0)
      kgTotal += Number(row.kg || 0)
      paymentTotals.set(row.payment_method, (paymentTotals.get(row.payment_method) ?? 0) + Number(row.total_amount || 0))
    }

    return {
      total,
      paid: paidRows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0),
      unpaid: unpaidRows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0),
      count: salesRows.length,
      average: salesRows.length ? total / salesRows.length : 0,
      kg: kgTotal,
      addOnTotal,
      serviceTotals: [...serviceTotals.entries()].sort((a, b) => b[1] - a[1]),
      paymentTotals,
      cancelledCount,
    }
  }, [salesRows, cancelledCount])

  const expenseTotal = useMemo(() => expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0), [expenses])
  const inventoryMap = useMemo(() => new Map(inventory.map((item) => [item.id, item])), [inventory])
  const inventoryReport = useMemo(() => {
    const usage = new Map<string, number>()
    let estimatedUsageCost = 0
    let adjustments = 0
    let wastage = 0

    for (const movement of movements) {
      const item = inventoryMap.get(movement.item_id)
      const quantity = Number(movement.quantity_delta || 0)
      if (movement.movement_type === 'consumption' && quantity < 0) {
        const used = Math.abs(quantity)
        usage.set(movement.item_id, (usage.get(movement.item_id) ?? 0) + used)
        estimatedUsageCost += used * Number(movement.unit_cost ?? item?.average_cost ?? 0)
      }
      if (movement.movement_type === 'wastage') wastage += Math.abs(quantity)
      if (movement.movement_type === 'adjustment' || movement.movement_type === 'correction') adjustments += quantity
    }

    return {
      stockValue: inventory.reduce((sum, item) => sum + Number(item.stock_value || 0), 0),
      lowStock: inventory.filter((item) => item.active && Number(item.reorder_threshold) > 0 && Number(item.current_quantity) <= Number(item.reorder_threshold)).length,
      outOfStock: inventory.filter((item) => item.active && Number(item.current_quantity) <= 0).length,
      estimatedUsageCost,
      adjustments,
      wastage,
      mostConsumed: [...usage.entries()]
        .map(([id, quantity]) => ({ name: inventoryMap.get(id)?.item_name ?? 'Unknown item', unit: inventoryMap.get(id)?.unit_label ?? '', quantity }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 5),
    }
  }, [inventory, inventoryMap, movements])

  const operatingResult = sales.total - expenseTotal
  const periodLabel = period.from === period.to ? period.from : period.from + ' to ' + period.to

  if (profile?.role !== 'owner') {
    return <InlineAlert variant="error" title="Owner access required">Reports are available only to the Owner.</InlineAlert>
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-violet-600">Phase 5 · Reports</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">Reports & Analytics</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">Read-only operational reporting for sales, active expenses, and inventory. Cancelled orders are shown separately and excluded from sales and result totals. Refund and settlement accounting is not modeled.</p>
        </div>
        <button type="button" onClick={() => void load(true)} disabled={loading || refreshing} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">{refreshing ? 'Refreshing…' : '↻ Refresh'}</button>
      </div>

      {error && <InlineAlert variant="error" title="Reports could not be refreshed" actionLabel="Try again" onAction={() => void load()}>{error} Existing loaded values remain visible.</InlineAlert>}
      {notice && <InlineAlert variant={notice.type}>{notice.text}</InlineAlert>}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-end gap-3">
          <div><label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Period</label><select value={preset} onChange={(event) => setPreset(event.target.value as Preset)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="custom">Custom range</option></select></div>
          {preset === 'custom' && <><div><label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">From</label><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" /></div><div><label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">To</label><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" /></div></>}
          <p className="pb-2 text-xs text-slate-500">Shop dates: {periodLabel}</p>
        </div>
      </section>

      <div className="flex items-center gap-2 flex-wrap">
        {(['sales', 'expenses', 'inventory'] as ReportTab[]).map((value) => <button key={value} type="button" onClick={() => setTab(value)} className={'rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition ' + (tab === value ? 'bg-violet-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300')}>{value}</button>)}
      </div>

      {loading ? <LoadingPanel label="Loading report data…" slowLabel="Still loading report data… the connection may be slow." /> : tab === 'sales' ? <SalesReport sales={sales} transactions={transactions} /> : tab === 'expenses' ? <ExpensesReport expenses={expenses} total={expenseTotal} operatingResult={operatingResult} salesTotal={sales.total} /> : <InventoryReport report={inventoryReport} inventory={inventory} movements={movements} />}
    </div>
  )
}

function SalesReport({ sales, transactions }: { sales: { total: number; paid: number; unpaid: number; count: number; average: number; kg: number; addOnTotal: number; serviceTotals: Array<[string, number]>; paymentTotals: Map<string, number>; cancelledCount: number }; transactions: Transaction[] }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Recorded sales" value={peso(sales.total)} hint={sales.count + ' non-cancelled orders'} />
        <Metric label="Paid sales" value={peso(sales.paid)} hint="Cash and GCash orders" />
        <Metric label="Pay Later" value={peso(sales.unpaid)} hint="Recorded outstanding amount" />
        <Metric label="Average order" value={peso(sales.average)} hint={sales.count + ' orders in period'} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Panel title="Sales activity"><StatLine label="Transaction count" value={String(sales.count)} /><StatLine label="Total kg processed" value={sales.kg.toLocaleString('en-PH') + ' kg'} /><StatLine label="Add-on revenue" value={peso(sales.addOnTotal)} /><StatLine label="Cancelled orders excluded" value={String(sales.cancelledCount)} /></Panel>
        <Panel title="Cash vs GCash"><StatLine label="Cash" value={peso(sales.paymentTotals.get('paid') ?? 0)} /><StatLine label="GCash" value={peso(sales.paymentTotals.get('gcash') ?? 0)} /><StatLine label="Pay Later" value={peso(sales.paymentTotals.get('pay_later') ?? 0)} /></Panel>
        <Panel title="Service revenue"><Breakdown rows={sales.serviceTotals} empty="No service sales in this period." /></Panel>
      </div>
      {transactions.length === 0 && <EmptyState title="No sales in this period" description="Sales will appear here when real orders exist for the selected shop dates." />}
    </div>
  )
}

function ExpensesReport({ expenses, total, operatingResult, salesTotal }: { expenses: ActiveExpense[]; total: number; operatingResult: number; salesTotal: number }) {
  const byCategory = new Map<string, number>()
  for (const expense of expenses) byCategory.set(expense.category_name ?? 'Uncategorized', (byCategory.get(expense.category_name ?? 'Uncategorized') ?? 0) + Number(expense.amount || 0))
  const rows = [...byCategory.entries()].sort((a, b) => b[1] - a[1])
  const margin = salesTotal ? (operatingResult / salesTotal) * 100 : 0

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Active expenses" value={peso(total)} hint={expenses.length + ' unvoided entries'} />
        <Metric label="Operating result" value={peso(operatingResult)} hint="Recorded sales minus active expenses" />
        <Metric label="Result margin" value={margin.toFixed(1) + '%'} hint="Before inventory cost" />
        <Metric label="Categories used" value={String(rows.length)} hint="Active entries in period" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Panel title="Expense breakdown"><Breakdown rows={rows} empty="No active expenses in this period." /></Panel>
        <Panel title="Expense trend"><p className="text-sm text-slate-500">The current foundation provides date-filtered totals and category breakdowns. A chart view can be added after real operating history accumulates.</p><StatLine label="Date-filtered entries" value={String(expenses.length)} /><StatLine label="Audit rule" value="Voided entries excluded" /></Panel>
      </div>
      {expenses.length === 0 && <EmptyState title="No expenses in this period" description="Record real operating costs in Expenses first. No test expense was created for this report." />}
    </div>
  )
}

function InventoryReport({ report, inventory, movements }: { report: { stockValue: number; lowStock: number; outOfStock: number; estimatedUsageCost: number; adjustments: number; wastage: number; mostConsumed: Array<{ name: string; unit: string; quantity: number }> }; inventory: InventoryItemSummary[]; movements: InventoryStockMovement[] }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Stock value at cost" value={peso(report.stockValue)} hint="Current ledger-derived balance" />
        <Metric label="Low stock" value={String(report.lowStock)} hint="Active items at/below threshold" />
        <Metric label="Out of stock" value={String(report.outOfStock)} hint="Active items at zero or below" />
        <Metric label="Estimated usage" value={peso(report.estimatedUsageCost)} hint="Consumption movements in period" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Panel title="Most consumed items">{report.mostConsumed.length === 0 ? <p className="text-sm text-slate-500">No consumption movements in this period.</p> : report.mostConsumed.map((item) => <StatLine key={item.name} label={item.name} value={item.quantity + ' ' + item.unit} />)}</Panel>
        <Panel title="Adjustments and wastage"><StatLine label="Net adjustments" value={String(report.adjustments)} /><StatLine label="Wastage quantity" value={String(report.wastage)} /><StatLine label="Movement rows" value={String(movements.length)} /></Panel>
        <Panel title="Inventory coverage"><StatLine label="Configured items" value={String(inventory.length)} /><StatLine label="Active items" value={String(inventory.filter((item) => item.active).length)} /><p className="mt-3 text-xs text-slate-500">Estimated usage is not a final accounting COGS figure. It uses movement unit cost when available, otherwise the current average cost.</p></Panel>
      </div>
      {inventory.length === 0 && <EmptyState title="No inventory configured" description="Add real supply categories and items in Inventory when the shop is ready." />}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900"><h2 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h2>{children}</section>
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{value}</p><p className="mt-1 text-xs text-slate-400">{hint}</p></div>
}

function StatLine({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800"><span className="text-slate-500">{label}</span><span className="font-medium text-slate-900 dark:text-slate-100">{value}</span></div>
}

function Breakdown({ rows, empty }: { rows: Array<[string, number]>; empty: string }) {
  return rows.length === 0 ? <p className="text-sm text-slate-500">{empty}</p> : <div className="space-y-2">{rows.map(([label, value]) => <StatLine key={label} label={label} value={peso(value)} />)}</div>
}
