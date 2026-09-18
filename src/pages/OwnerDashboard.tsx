import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useTransactions } from '../hooks/useTransactions'
import TransactionTable from '../components/TransactionTable'
import StaffAccountsManager from '../components/StaffAccountsManager'
import ServicePricingManager from '../components/ServicePricingManager'
import AddOnsManager from '../components/AddOnsManager'
import DiscountPromosManager from '../components/DiscountPromosManager'
import OwnerSettingsManager from '../components/OwnerSettingsManager'
import InventoryManager from '../components/InventoryManager'
import ExpensesManager from '../components/ExpensesManager'
import ReportsManager from '../components/ReportsManager'
import LoyaltyManager from '../components/LoyaltyManager'
import { ButtonSpinner, InlineAlert, LoadingPanel } from '../components/UiFeedback'
import type { PaymentMethod } from '../types/database'
import { shopDate, shopDateDaysAgo } from '../lib/date'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import { useShopSettings } from '../lib/shop-settings-context'
import { edgeFunctionErrorMessage } from '../lib/edge-functions'
import { openTransactionPdfReport } from '../lib/pdf-report'
import UiIcon, { type IconName } from '../components/UiIcon'

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Tab = 'overview' | 'staff' | 'pricing' | 'addons' | 'discounts' | 'inventory' | 'expenses' | 'reports' | 'loyalty' | 'settings'

const TAB_ICONS: Record<Tab, IconName> = {
  overview: 'dashboard',
  staff: 'staff',
  pricing: 'tag',
  addons: 'gift',
  discounts: 'tag',
  inventory: 'inventory',
  expenses: 'money',
  reports: 'download',
  loyalty: 'gift',
  settings: 'settings',
}

export default function OwnerDashboard() {
  const { profile } = useAuth()
  const { settings, loading: settingsLoading } = useShopSettings()
  const isOwner = profile?.role === 'owner'

  const [tab, setTab] = useState<Tab>('overview')
  const [dateFrom, setDateFrom] = useState(shopDateDaysAgo(6))
  const [dateTo, setDateTo] = useState(shopDate())
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | 'all'>('all')
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const exportingRef = useRef(false)
  const appliedDefaultRangeRef = useRef(false)
  const [showDeleted, setShowDeleted] = useState(false)

  useEffect(() => {
    if (settingsLoading || appliedDefaultRangeRef.current) return
    setDateFrom(shopDateDaysAgo(Math.max(0, settings.default_dashboard_days - 1)))
    setDateTo(shopDate())
    appliedDefaultRangeRef.current = true
  }, [settings.default_dashboard_days, settingsLoading])

  useEffect(() => {
    if (!isOwner && tab !== 'overview') setTab('overview')
  }, [isOwner, tab])

  // Hooks must run in the same order on every render. Even while Settings is
  // still loading we subscribe with the safe default scope, then decide below
  // whether Staff should see the Dashboard at all.
  const todayOnlyForStaff = !isOwner && !settings.staff_can_view_full_history
  const effectiveDateFrom = todayOnlyForStaff ? shopDate() : dateFrom
  const effectiveDateTo = todayOnlyForStaff ? shopDate() : dateTo

  const { rows, loading, error, realtimeState, reload } = useTransactions({
    dateFrom: effectiveDateFrom,
    dateTo: effectiveDateTo,
    limit: 1000,
    includeDeleted: isOwner && showDeleted,
  })

  const activeRows = useMemo(() => rows.filter((r) => !r.deleted_at), [rows])

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (methodFilter !== 'all' && r.payment_method !== methodFilter) return false
      if (search && !r.customer_name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [rows, methodFilter, search])

  const stats = useMemo(() => {
    const today = shopDate()
    const todayRows = activeRows.filter((r) => r.transaction_date === today)
    const cashRows = activeRows.filter((r) => r.payment_method === 'paid')
    const gcashRows = activeRows.filter((r) => r.payment_method === 'gcash')
    const payLaterRows = activeRows.filter((r) => r.payment_method === 'pay_later')

    return {
      salesToday: todayRows.reduce((sum, r) => sum + (r.total_amount || 0), 0),
      countToday: todayRows.length,
      salesRange: activeRows.reduce((sum, r) => sum + (r.total_amount || 0), 0),
      cashTotal: cashRows.reduce((sum, r) => sum + (r.total_amount || 0), 0),
      cashCount: cashRows.length,
      gcashTotal: gcashRows.reduce((sum, r) => sum + (r.total_amount || 0), 0),
      gcashCount: gcashRows.length,
      payLaterTotal: payLaterRows.reduce((sum, r) => sum + (r.total_amount || 0), 0),
      payLaterCount: payLaterRows.length,
    }
  }, [activeRows])

  if (!isOwner && settingsLoading) {
    return <LoadingPanel label="Checking Staff Dashboard access…" slowLabel="Still checking access… your connection may be slow." />
  }

  if (!isOwner && !settings.staff_can_access_dashboard) {
    return <Navigate to="/" replace />
  }

  const exportSpreadsheet = async (outputFormat: 'csv' | 'google_sheets') => {
    if (!isOwner || exportingRef.current) return
    exportingRef.current = true
    setExporting(true)
    setExportMessage(null)

    try {
      const { data, error: functionError } = await supabase.functions.invoke('export-transactions', {
        body: {
          date_from: dateFrom,
          date_to: dateTo,
          payment_method: methodFilter,
          search,
          output_format: outputFormat,
        },
      })

      if (functionError) {
        setExportMessage(await edgeFunctionErrorMessage(functionError, 'Export failed. Please try again.'))
        return
      }

      if (data?.error) {
        setExportMessage(String(data.error))
        return
      }

      if (outputFormat === 'google_sheets') {
        if (typeof data?.sheet_url !== 'string') {
          setExportMessage('The n8n export did not return a Google Sheet link.')
          return
        }
        window.open(data.sheet_url, '_blank', 'noopener,noreferrer')
        setExportMessage(`Sent ${data.row_count ?? filtered.length} transactions to Google Sheets.`)
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
    } finally {
      setExporting(false)
      exportingRef.current = false
    }
  }

  const exportPdf = () => {
    if (!isOwner) return
    setExportMessage(null)
    try {
      openTransactionPdfReport({
        rows: filtered,
        dateFrom,
        dateTo,
        paymentMethod: methodFilter,
        search,
        shopName: settings.shop_display_name,
        contactPhone: settings.contact_phone,
        reportFooter: settings.report_footer,
      })
      setExportMessage('PDF report opened. Choose “Save as PDF” in the print dialog.')
    } catch (pdfError) {
      setExportMessage(pdfError instanceof Error ? pdfError.message : 'Could not open the PDF report.')
    }
  }

  const tabClass = (active: boolean) =>
    `inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
      active
        ? 'bg-sky-600 text-white'
        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800'
    }`

  const exportLooksLikeError = Boolean(exportMessage && /failed|could not|did not|error/i.test(exportMessage))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => setTab('overview')} className={tabClass(tab === 'overview')}><UiIcon name={TAB_ICONS.overview} size={16} />Overview</button>
        {isOwner && (
          <>
            <button type="button" onClick={() => setTab('staff')} className={tabClass(tab === 'staff')}><UiIcon name={TAB_ICONS.staff} size={16} />Staff Accounts</button>
            <button type="button" onClick={() => setTab('pricing')} className={tabClass(tab === 'pricing')}><UiIcon name={TAB_ICONS.pricing} size={16} />Service Pricing</button>
            <button type="button" onClick={() => setTab('addons')} className={tabClass(tab === 'addons')}><UiIcon name={TAB_ICONS.addons} size={16} />Add-ons</button>
            <button type="button" onClick={() => setTab('discounts')} className={tabClass(tab === 'discounts')}><UiIcon name={TAB_ICONS.discounts} size={16} />Discounts &amp; Promos</button>
            <button type="button" onClick={() => setTab('inventory')} className={tabClass(tab === 'inventory')}><UiIcon name={TAB_ICONS.inventory} size={16} />Inventory</button>
            <button type="button" onClick={() => setTab('expenses')} className={tabClass(tab === 'expenses')}><UiIcon name={TAB_ICONS.expenses} size={16} />Expenses</button>
            <button type="button" onClick={() => setTab('reports')} className={tabClass(tab === 'reports')}><UiIcon name={TAB_ICONS.reports} size={16} />Reports</button>
            <button type="button" onClick={() => setTab('loyalty')} className={tabClass(tab === 'loyalty')}><UiIcon name={TAB_ICONS.loyalty} size={16} />Loyalty</button>
            <button type="button" onClick={() => setTab('settings')} className={tabClass(tab === 'settings')}><UiIcon name={TAB_ICONS.settings} size={16} />Settings</button>
          </>
        )}
      </div>

      {tab === 'overview' && (
        <>
          <div className="space-y-2">
            {todayOnlyForStaff && (
              <InlineAlert variant="info" title="Staff history is limited to today">
                The Owner has limited Staff transaction visibility to today's records. Historical data remains protected by database access rules.
              </InlineAlert>
            )}
            {!isOwner && settings.staff_can_view_full_history && !settings.staff_can_view_historical_pay_later && (
              <InlineAlert variant="info" title="Historical Pay Later accounts are Owner-only">
                Today's Pay Later transactions remain visible, but older Pay Later accounts are hidden from Staff.
              </InlineAlert>
            )}
            {error && (
              <InlineAlert variant="error" title="Dashboard data could not be refreshed" actionLabel="Try again" onAction={() => void reload()}>
                {error} Existing rows remain visible so you can review what was already loaded.
              </InlineAlert>
            )}
            {!error && (realtimeState === 'disconnected' || realtimeState === 'error') && (
              <InlineAlert variant="warning" title="Live sync is temporarily offline" actionLabel="Refresh now" onAction={() => void reload()}>
                Aquaspin is still usable. Changes from other browsers may not appear immediately until Realtime reconnects.
              </InlineAlert>
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-900">
              <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"><UiIcon name="money" size={18} /></span>
              <p className="text-xs text-slate-500">Today's Sales</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{peso(stats.salesToday)}</p>
              <p className="mt-1 text-xs text-slate-400">{stats.countToday} transactions today</p>
            </div>
            <PaymentFilterCard label={todayOnlyForStaff ? "Today's Sales" : 'Selected Sales'} value={peso(stats.salesRange)} hint={`${activeRows.length} transactions · click for all`} icon="dashboard" active={methodFilter === 'all'} onClick={() => setMethodFilter('all')} />
            <PaymentFilterCard label="Cash" value={peso(stats.cashTotal)} hint={`${stats.cashCount} customers · click to view`} icon="money" active={methodFilter === 'paid'} onClick={() => setMethodFilter('paid')} />
            <PaymentFilterCard label="GCash" value={peso(stats.gcashTotal)} hint={`${stats.gcashCount} customers · click to view`} icon="money" active={methodFilter === 'gcash'} onClick={() => setMethodFilter('gcash')} />
            <PaymentFilterCard label="Pay Later" value={peso(stats.payLaterTotal)} hint={`${stats.payLaterCount} accounts · click to view`} icon="alert" active={methodFilter === 'pay_later'} onClick={() => setMethodFilter('pay_later')} />
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:bg-slate-900 dark:border-slate-800">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-slate-100">Transactions</h2>
                <p className="text-xs text-slate-400 mt-0.5">Click a payment card above to drill into Cash, GCash, or Pay Later accounts.</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {isOwner && (
                  <>
                    <button type="button" onClick={exportPdf} className="inline-flex items-center gap-2 rounded-lg border border-violet-300 px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/40"><UiIcon name="download" size={16} />Export PDF</button>
                    <button type="button" onClick={() => void exportSpreadsheet('csv')} disabled={exporting} className="inline-flex items-center gap-2 rounded-lg border border-sky-300 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50 dark:border-sky-800 dark:text-sky-300 dark:hover:bg-sky-950/40">
                      {exporting && <ButtonSpinner />}{!exporting && <UiIcon name="download" size={16} />}{exporting ? 'Exporting…' : 'Export CSV'}
                    </button>
                    <button type="button" onClick={() => void exportSpreadsheet('google_sheets')} disabled={exporting} className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40">
                      {exporting && <ButtonSpinner />}{!exporting && <UiIcon name="download" size={16} />}{exporting ? 'Exporting…' : 'Export to Google Sheets'}
                    </button>
                  </>
                )}
                <button type="button" onClick={() => void reload()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                  <UiIcon name="refresh" size={16} />{loading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            </div>

            {isOwner && (
              <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} className="h-3.5 w-3.5" />
                Show deleted (who deleted it, when, and why — never counted in the totals above)
              </label>
            )}

            {exportMessage && (
              <InlineAlert variant={exportLooksLikeError ? 'error' : 'success'} title={exportLooksLikeError ? 'Export could not finish' : 'Export ready'}>
                {exportMessage}
              </InlineAlert>
            )}

            {!todayOnlyForStaff && (
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">From</label>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">To</label>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Payment</label>
                <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value as PaymentMethod | 'all')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950">
                  <option value="all">All</option><option value="paid">Cash</option><option value="gcash">GCash</option><option value="pay_later">Pay Later</option>
                </select>
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Search customer</label>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name…" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
              </div>
            </div>

            <TransactionTable rows={filtered} loading={loading} isOwner={isOwner} />
          </div>
        </>
      )}

      {isOwner && tab === 'staff' && <StaffAccountsManager />}
      {isOwner && tab === 'pricing' && <ServicePricingManager />}
      {isOwner && tab === 'addons' && <AddOnsManager />}
      {isOwner && tab === 'discounts' && <DiscountPromosManager />}
      {isOwner && tab === 'inventory' && <InventoryManager />}
      {isOwner && tab === 'expenses' && <ExpensesManager />}
      {isOwner && tab === 'reports' && <ReportsManager />}
      {isOwner && tab === 'loyalty' && <LoyaltyManager />}
      {isOwner && tab === 'settings' && <OwnerSettingsManager />}
    </div>
  )
}

function PaymentFilterCard({ label, value, hint, icon, active, onClick }: { label: string; value: string; hint: string; icon: IconName; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${active ? 'border-sky-400 bg-sky-50 ring-2 ring-sky-100 dark:border-sky-700 dark:bg-sky-950/30 dark:ring-sky-950' : 'border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-800 dark:hover:bg-slate-800'}`}>
      <span className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${active ? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}><UiIcon name={icon} size={18} /></span>
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{hint}</p>
    </button>
  )
}
