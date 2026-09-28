import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import CustomerForm from '../components/CustomerForm'
import BentoCard from '../components/BentoCard'
import UiIcon, { type IconName } from '../components/UiIcon'
import { EmptyState, InlineAlert, LoadingPanel } from '../components/UiFeedback'
import { useCustomers } from '../hooks/useCustomers'
import { useAuth } from '../lib/auth-context'
import { useShopSettings } from '../lib/shop-settings-context'
import { getCustomerDirectoryRows, paginateCustomerRows, type CustomerActivityFilter, type CustomerDirectorySort } from '../lib/customer-directory'
import type { Customer } from '../types/customer-status'

const PAGE_SIZE = 20
const peso = (value: number) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const visitDate = (value: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function CustomersPage() {
  const { profile } = useAuth()
  const { settings } = useShopSettings()
  const isOwner = profile?.role === 'owner'
  const canManage = isOwner || settings.staff_can_manage_customers
  const { rows, loading, error, realtimeState, directoryDataWarning, reload } = useCustomers({ includeRedemptions: isOwner })
  const [search, setSearch] = useState('')
  const [activity, setActivity] = useState<CustomerActivityFilter>('active')
  const [sort, setSort] = useState<CustomerDirectorySort>('name')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Customer | null | undefined>(undefined)

  const visibleSort = !isOwner && sort === 'redeemed' ? 'name' : sort
  const filtered = useMemo(() => getCustomerDirectoryRows(rows, { search, activity, sort: visibleSort }), [activity, rows, search, visibleSort])
  const pageData = useMemo(() => paginateCustomerRows(filtered, page, PAGE_SIZE), [filtered, page])
  const totalOutstanding = rows.reduce((sum, row) => sum + Number(row.outstanding_balance || 0), 0)

  return (
    <div className="space-y-5">
      <BentoCard title="Customers" description="Find repeat customers and review their laundry history in one place." icon="customers" tone="sky" action={canManage && <button type="button" onClick={() => setEditing(null)} className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"><UiIcon name="plus" size={16} />Add customer</button>}>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600 dark:text-sky-400">Phase 2 · Customer directory</p>
      </BentoCard>
      {editing !== undefined && <CustomerForm customer={editing} isOwner={isOwner} onCancel={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void reload() }} onDeleted={() => { setEditing(undefined); void reload() }} />}
      {!canManage && <InlineAlert variant="info" title="Customer changes are disabled">The Owner has turned off Staff customer management. You can still search and review customer records.</InlineAlert>}
      {error && <InlineAlert variant="error" title="Customers could not be refreshed" actionLabel="Try again" onAction={() => void reload()}>{error}</InlineAlert>}
      {!error && (realtimeState === 'error' || realtimeState === 'disconnected') && <InlineAlert variant="warning" title="Live customer sync is temporarily offline" actionLabel="Refresh now" onAction={() => void reload()}>Existing rows remain visible until the connection recovers.</InlineAlert>}
      {directoryDataWarning && <InlineAlert variant="warning" title="Some directory filters may be limited">{directoryDataWarning}</InlineAlert>}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Summary label="Customers" value={String(rows.length)} icon="customers" /><Summary label="Active" value={String(rows.filter((row) => row.active).length)} icon="profile" /><Summary label="Visits" value={String(rows.reduce((sum, row) => sum + Number(row.total_transactions || 0), 0))} icon="orders" /><Summary label="Outstanding" value={peso(totalOutstanding)} icon="money" warning={totalOutstanding > 0} /></section>
      <BentoCard title="Find a customer" description="Search by name, phone number, or canonical customer ID." icon="search">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Search<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-950" placeholder="Name, phone, or CUS-ID" /></label>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Sort/view by<select value={visibleSort} onChange={(event) => { setSort(event.target.value as CustomerDirectorySort); setPage(1) }} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"><option value="name">Name (A–Z)</option><option value="newest">Newest</option><option value="most_visits">Most visits</option>{isOwner && <option value="redeemed" disabled={Boolean(directoryDataWarning?.includes('Reward redemption data'))}>Already redeemed a reward</option>}</select></label>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Customer status<select value={activity} onChange={(event) => { setActivity(event.target.value as CustomerActivityFilter); setPage(1) }} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"><option value="active">Active</option><option value="all">All</option><option value="inactive">Inactive</option></select></label>
        </div>
      </BentoCard>
      {loading ? <LoadingPanel label="Loading customers…" slowLabel="Still loading customer records…" /> : pageData.total === 0 ? <EmptyState title={rows.length === 0 ? 'No customers yet' : 'No customers match this search'} description={rows.length === 0 ? 'Add the first canonical customer to start building repeat-customer history.' : 'Try a different name, phone number, status, or view.'} /> : (
        <BentoCard title="Customer directory" description={`${filtered.length} customer${filtered.length === 1 ? '' : 's'} shown`} icon="customers" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead><tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700"><th scope="col" className="px-4 py-3">Name</th><th scope="col" className="px-4 py-3">CUS-ID</th><th scope="col" className="px-4 py-3">Phone</th><th scope="col" className="px-4 py-3 text-right">Visits</th><th scope="col" className="px-4 py-3">Last visit</th><th scope="col" className="px-4 py-3 text-right">Outstanding</th><th scope="col" className="px-4 py-3 text-right">Loyalty points</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{pageData.rows.map((row) => <tr key={row.id} className="transition hover:bg-slate-50 dark:hover:bg-slate-800/40"><th scope="row" className="px-4 py-3 font-medium"><Link to={`/customers/${row.id}`} className="text-sky-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-sky-300">{row.full_name}</Link>{!row.active && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">Inactive</span>}</th><td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">{row.customer_code}</td><td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.phone_number || '—'}</td><td className="px-4 py-3 text-right tabular-nums">{Number(row.total_transactions || 0)}</td><td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">{visitDate(row.last_visit)}</td><td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">{peso(Number(row.outstanding_balance))}</td><td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-emerald-700 dark:text-emerald-300">{row.points_balance === null ? '—' : `${Number(row.points_balance).toLocaleString('en-PH', { maximumFractionDigits: 2 })} pts`}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">Showing {pageData.total === 0 ? 0 : (pageData.page - 1) * PAGE_SIZE + 1}–{Math.min(pageData.page * PAGE_SIZE, pageData.total)} of {pageData.total}</p>
            <div className="flex items-center justify-between gap-3 sm:justify-end"><button type="button" disabled={pageData.page <= 1} onClick={() => setPage(pageData.page - 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Previous</button><span aria-live="polite" className="min-w-20 text-center text-sm text-slate-600 dark:text-slate-300">Page {pageData.page} of {pageData.pageCount}</span><button type="button" disabled={pageData.page >= pageData.pageCount} onClick={() => setPage(pageData.page + 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Next</button></div>
          </div>
        </BentoCard>
      )}
    </div>
  )
}

function Summary({ label, value, icon, warning = false }: { label: string; value: string; icon: IconName; warning?: boolean }) { return <div className={`rounded-2xl border p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${warning ? 'border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}><span className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${warning ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}><UiIcon name={icon} size={18} /></span><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{value}</p></div> }
