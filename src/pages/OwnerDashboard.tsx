import { useMemo, useState } from 'react'
import { useTransactions } from '../hooks/useTransactions'
import TransactionTable from '../components/TransactionTable'
import StaffAccountsManager from '../components/StaffAccountsManager'
import ServicePricingManager from '../components/ServicePricingManager'
import AddOnsManager from '../components/AddOnsManager'
import type { PaymentMethod } from '../types/database'
import { shopDate, shopDateDaysAgo } from '../lib/date'
import { supabase } from '../lib/supabase'

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Tab = 'overview' | 'staff' | 'pricing' | 'addons'

export default function OwnerDashboard() {
  const [tab, setTab] = useState<Tab>('overview')
  const [dateFrom, setDateFrom] = useState(shopDateDaysAgo(6))
  const [dateTo, setDateTo] = useState(shopDate())
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | 'all'>('all')
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)

  const { rows, loading, reload } = useTransactions({ dateFrom, dateTo, limit: 1000 })

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (methodFilter !== 'all' && r.payment_method !== methodFilter) return false
      if (search && !r.customer_name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [rows, methodFilter, search])

  const stats = useMemo(() => {
    const today = shopDate()
    const todayRows = rows.filter((r) => r.transaction_date === today)
    const cashRows = rows.filter((r) => r.payment_method === 'paid')
    const gcashRows = rows.filter((r) => r.payment_method === 'gcash')
    const payLaterRows = rows.filter((r) => r.payment_method === 'pay_later')

    return {
      salesToday: todayRows.reduce((sum, r) => sum + (r.total_amount || 0), 0),
      countToday: todayRows.length,
      salesRange: rows.reduce((sum, r) => sum + (r.total_amount || 0), 0),
      cashTotal: cashRows.reduce((sum, r) => sum + (r.total_amount || 0), 0),
      cashCount: cashRows.length,
      gcashTotal: gcashRows.reduce((sum, r) => sum + (r.total_amount || 0), 0),
      gcashCount: gcashRows.length,
      payLaterTotal: payLaterRows.reduce((sum, r) => sum + (r.total_amount || 0), 0),
      payLaterCount: payLaterRows.length,
    }
  }, [rows])

  const exportSpreadsheet = async () => {
    setExporting(true)
    setExportMessage(null)

    const { data, error } = await supabase.functions.invoke('export-transactions', {
      body: {
        date_from: dateFrom,
        date_to: dateTo,
        payment_method: methodFilter,
        search,
      },
    })

    setExporting(false)

    if (error) {
      setExportMessage(error.message)
      return
    }

    if (data?.error) {
      setExportMessage(String(data.error))
      return
    }

    if (typeof data?.csv !== 'string') {
      setExportMessage('The n8n export did not return a spreadsheet file.')
      return
    }

    const blob = new Blob([data.csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = typeof data.filename === 'string' ? data.filename : 'aquaspin-transactions.csv'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)

    setExportMessage(`Exported ${data.row_count ?? filtered.length} transactions via n8n.`)
  }

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
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500">Today's Sales</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{peso(stats.salesToday)}</p>
              <p className="mt-1 text-xs text-slate-400">{stats.countToday} transactions today</p>
            </div>
            <PaymentFilterCard
              label="Selected Sales"
              value={peso(stats.salesRange)}
              hint={`${rows.length} transactions · click for all`}
              active={methodFilter === 'all'}
              onClick={() => setMethodFilter('all')}
            />
            <PaymentFilterCard
              label="Cash"
              value={peso(stats.cashTotal)}
              hint={`${stats.cashCount} customers · click to view`}
              active={methodFilter === 'paid'}
              onClick={() => setMethodFilter('paid')}
            />
            <PaymentFilterCard
              label="GCash"
              value={peso(stats.gcashTotal)}
              hint={`${stats.gcashCount} customers · click to view`}
              active={methodFilter === 'gcash'}
              onClick={() => setMethodFilter('gcash')}
            />
            <PaymentFilterCard
              label="Pay Later"
              value={peso(stats.payLaterTotal)}
              hint={`${stats.payLaterCount} accounts · click to view`}
              active={methodFilter === 'pay_later'}
              onClick={() => setMethodFilter('pay_later')}
            />
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 dark:bg-slate-900 dark:border-slate-800">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-slate-100">Transactions</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Click a payment card above to drill into Cash, GCash, or Pay Later accounts.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={exportSpreadsheet}
                  disabled={exporting}
                  className="rounded-lg border border-sky-300 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50 dark:border-sky-800 dark:text-sky-300 dark:hover:bg-sky-950/40"
                >
                  {exporting ? 'Exporting…' : '⇩ Export Spreadsheet (n8n)'}
                </button>
                <button
                  type="button"
                  onClick={reload}
                  disabled={loading}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {loading ? 'Refreshing…' : '↻ Refresh'}
                </button>
              </div>
            </div>

            {exportMessage && (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {exportMessage}
              </p>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">From</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">To</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Payment</label>
                <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value as PaymentMethod | 'all')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950">
                  <option value="all">All</option>
                  <option value="paid">Cash</option>
                  <option value="gcash">GCash</option>
                  <option value="pay_later">Pay Later</option>
                </select>
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Search customer</label>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name…" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
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

function PaymentFilterCard({
  label,
  value,
  hint,
  active,
  onClick,
}: {
  label: string
  value: string
  hint: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition ${
        active
          ? 'border-sky-400 bg-sky-50 ring-2 ring-sky-100 dark:border-sky-700 dark:bg-sky-950/30 dark:ring-sky-950'
          : 'border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-800 dark:hover:bg-slate-800'
      }`}
    >
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{hint}</p>
    </button>
  )
}
