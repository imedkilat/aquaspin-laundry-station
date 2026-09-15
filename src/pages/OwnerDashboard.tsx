import { useMemo, useState } from 'react'
import { useTransactions } from '../hooks/useTransactions'
import TransactionTable from '../components/TransactionTable'
import StatCard from '../components/StatCard'
import StaffAccountsManager from '../components/StaffAccountsManager'
import ServicePricingManager from '../components/ServicePricingManager'
import AddOnsManager from '../components/AddOnsManager'
import type { PaymentMethod } from '../types/database'
import { shopDate, shopDateDaysAgo } from '../lib/date'

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Tab = 'overview' | 'staff' | 'pricing' | 'addons'

export default function OwnerDashboard() {
  const [tab, setTab] = useState<Tab>('overview')
  const [dateFrom, setDateFrom] = useState(shopDateDaysAgo(6))
  const [dateTo, setDateTo] = useState(shopDate())
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | 'all'>('all')
  const [search, setSearch] = useState('')

  const { rows, loading, reload } = useTransactions({ dateFrom, dateTo, limit: 1000 })

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (methodFilter !== 'all' && r.payment_method !== methodFilter) return false
      if (search && !r.customer_name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [rows, methodFilter, search])

  const todayRows = useMemo(() => rows.filter((r) => r.transaction_date === shopDate()), [rows])

  const stats = useMemo(() => {
    const revenueToday = todayRows.reduce((sum, r) => sum + (r.total_amount || 0), 0)
    const revenueRange = filtered.reduce((sum, r) => sum + (r.total_amount || 0), 0)
    const payLater = filtered.filter((r) => r.payment_method === 'pay_later')
    const payLaterTotal = payLater.reduce((sum, r) => sum + (r.total_amount || 0), 0)
    return {
      revenueToday,
      revenueRange,
      countToday: todayRows.length,
      payLaterCount: payLater.length,
      payLaterTotal,
    }
  }, [todayRows, filtered])

  const tabClass = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium transition ${
      active
        ? 'bg-sky-600 text-white'
        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800'
    }`

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setTab('overview')} className={tabClass(tab === 'overview')}>Overview</button>
        <button onClick={() => setTab('staff')} className={tabClass(tab === 'staff')}>Staff Accounts</button>
        <button onClick={() => setTab('pricing')} className={tabClass(tab === 'pricing')}>Service Pricing</button>
        <button onClick={() => setTab('addons')} className={tabClass(tab === 'addons')}>Add-ons</button>
      </div>

      {tab === 'overview' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Today's Revenue" value={peso(stats.revenueToday)} hint={`${stats.countToday} transactions`} />
            <StatCard label="Revenue (selected range)" value={peso(stats.revenueRange)} />
            <StatCard label="Pay Later — count" value={String(stats.payLaterCount)} hint="in selected range" />
            <StatCard label="Pay Later — outstanding" value={peso(stats.payLaterTotal)} />
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 dark:bg-slate-900 dark:border-slate-800">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-slate-100">Transactions</h2>
                <p className="text-xs text-slate-400 mt-0.5">Live updates are enabled. Use Refresh for an instant manual sync.</p>
              </div>
              <button
                type="button"
                onClick={reload}
                disabled={loading}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {loading ? 'Refreshing…' : '↻ Refresh'}
              </button>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Payment</label>
                <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value as PaymentMethod | 'all')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
                  <option value="all">All</option>
                  <option value="paid">Cash</option>
                  <option value="gcash">GCash</option>
                  <option value="pay_later">Pay Later</option>
                </select>
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs font-medium text-slate-600 mb-1">Search customer</label>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name…" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
              </div>
            </div>

            <TransactionTable rows={filtered} loading={loading} />
          </div>
        </>
      )}

      {tab === 'staff' && <StaffAccountsManager />}
      {tab === 'pricing' && <ServicePricingManager />}
      {tab === 'addons' && <AddOnsManager />}
    </div>
  )
}
