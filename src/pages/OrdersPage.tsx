import { useMemo, useState } from 'react'
import ActionErrorBoundary from '../components/ActionErrorBoundary'
import DeleteTransactionModal from '../components/DeleteTransactionModal'
import EditTransactionModal from '../components/EditTransactionModal'
import TransactionTable from '../components/TransactionTable'
import { InlineAlert } from '../components/UiFeedback'
import { useShopDate } from '../hooks/useShopDate'
import { useTransactions } from '../hooks/useTransactions'
import { useAuth } from '../lib/auth-context'
import { shopDateDaysAgo } from '../lib/date'
import { useShopSettings } from '../lib/shop-settings-context'
import type { PaymentMethod, TransactionWithService } from '../types/database'

const peso = (value: number) =>
  `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function OrdersPage() {
  const { profile } = useAuth()
  const { settings } = useShopSettings()
  const isOwner = profile?.role === 'owner'
  const historyRestricted = !isOwner && (!settings.staff_can_access_dashboard || !settings.staff_can_view_full_history)
  const today = useShopDate()

  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [search, setSearch] = useState('')
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | 'all'>('all')
  const [showDeleted, setShowDeleted] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<TransactionWithService | null>(null)
  const [deletingTransaction, setDeletingTransaction] = useState<TransactionWithService | null>(null)

  const effectiveDateFrom = historyRestricted ? today : dateFrom
  const effectiveDateTo = historyRestricted ? today : dateTo

  const { rows, loading, error, realtimeState, reload } = useTransactions({
    dateFrom: effectiveDateFrom,
    dateTo: effectiveDateTo,
    limit: 1000,
    includeDeleted: isOwner && showDeleted,
    fetchAll: true,
  })

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (methodFilter !== 'all' && row.payment_method !== methodFilter) return false
      if (!needle) return true
      return [row.customer_name, row.phone_number || '', row.transaction_code || '']
        .some((value) => value.toLowerCase().includes(needle))
    })
  }, [rows, search, methodFilter])

  const stats = useMemo(() => {
    const activeRows = filtered.filter((row) => !row.deleted_at)
    return {
      sales: activeRows.reduce((sum, row) => sum + (row.total_amount || 0), 0),
      orders: activeRows.length,
      kg: activeRows.reduce((sum, row) => sum + (row.kg || 0), 0),
      receivables: activeRows
        .filter((row) => row.payment_method === 'pay_later')
        .reduce((sum, row) => sum + (row.total_amount || 0), 0),
    }
  }, [filtered])

  const closeEdit = () => {
    setEditingTransaction(null)
    void reload()
  }

  const closeDelete = () => {
    setDeletingTransaction(null)
    void reload()
  }

  const setRange = (days: number) => {
    setDateFrom(shopDateDaysAgo(days - 1))
    setDateTo(today)
  }

  return (
    <>
      <div className="space-y-5">
        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600 dark:text-sky-400">Operations</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">Orders</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Search, review, edit, and manage laundry transactions from one screen.</p>
        </section>

        <div className="space-y-2">
          {historyRestricted && (
            <InlineAlert variant="info" title="Staff history is limited to today">
              Historical orders require both Dashboard access and Full History permission. Today's operational records remain available to Staff.
            </InlineAlert>
          )}
          {error && (
            <InlineAlert variant="error" title="Orders could not be refreshed" actionLabel="Try again" onAction={() => void reload()}>
              {error} Existing rows stay visible until refresh succeeds.
            </InlineAlert>
          )}
          {!error && (realtimeState === 'disconnected' || realtimeState === 'error') && (
            <InlineAlert variant="warning" title="Live sync is temporarily offline" actionLabel="Refresh now" onAction={() => void reload()}>
              You can keep using Aquaspin, but changes from another browser may not appear immediately.
            </InlineAlert>
          )}
        </div>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard label="Sales" value={peso(stats.sales)} />
          <SummaryCard label="Orders" value={String(stats.orders)} />
          <SummaryCard label="Weight" value={`${stats.kg.toFixed(stats.kg % 1 === 0 ? 0 : 1)} kg`} />
          <SummaryCard label="Pay Later" value={peso(stats.receivables)} warning={stats.receivables > 0} />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-5">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-end">
            <div>
              <label htmlFor="orders-search" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Search</label>
              <input
                id="orders-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Customer, phone, or AQ transaction ID"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-sky-950"
              />
            </div>
            <div>
              <label htmlFor="orders-payment" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Payment</label>
              <select
                id="orders-payment"
                value={methodFilter}
                onChange={(event) => setMethodFilter(event.target.value as PaymentMethod | 'all')}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 lg:w-40"
              >
                <option value="all">All payments</option>
                <option value="paid">Cash</option>
                <option value="gcash">GCash</option>
                <option value="pay_later">Pay Later</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => void reload()}
              disabled={loading}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {loading ? 'Refreshing…' : '↻ Refresh'}
            </button>
          </div>

          {!historyRestricted && (
            <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              <button type="button" onClick={() => setRange(1)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">Today</button>
              <button type="button" onClick={() => setRange(7)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">7 days</button>
              <button type="button" onClick={() => setRange(30)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">30 days</button>
              <label className="ml-0 flex items-center gap-2 text-xs text-slate-500 sm:ml-2 dark:text-slate-400">
                <span>From</span>
                <input aria-label="Orders from date" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950" />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>To</span>
                <input aria-label="Orders to date" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950" />
              </label>
              {isOwner && (
                <label className="ml-auto flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <input type="checkbox" checked={showDeleted} onChange={(event) => setShowDeleted(event.target.checked)} />
                  Show deleted
                </label>
              )}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">Transaction History</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{filtered.length} matching records · {effectiveDateFrom} to {effectiveDateTo}</p>
            </div>
          </div>
          <TransactionTable
            rows={filtered}
            loading={loading}
            isOwner={isOwner}
            onEdit={setEditingTransaction}
            onDelete={setDeletingTransaction}
          />
        </section>
      </div>

      {editingTransaction && (
        <ActionErrorBoundary key={`orders-edit-${editingTransaction.id}`} onClose={closeEdit}>
          <EditTransactionModal transaction={editingTransaction} onClose={closeEdit} />
        </ActionErrorBoundary>
      )}

      {deletingTransaction && (
        <ActionErrorBoundary key={`orders-delete-${deletingTransaction.id}`} onClose={closeDelete}>
          <DeleteTransactionModal transaction={deletingTransaction} onClose={closeDelete} />
        </ActionErrorBoundary>
      )}
    </>
  )
}

function SummaryCard({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className={`rounded-2xl border bg-white p-4 dark:bg-slate-900 ${warning ? 'border-amber-200 dark:border-amber-900' : 'border-slate-200 dark:border-slate-800'}`}>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${warning ? 'text-amber-700 dark:text-amber-300' : 'text-slate-900 dark:text-slate-100'}`}>{value}</p>
    </div>
  )
}
