import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import CustomerForm from '../components/CustomerForm'
import { EmptyState, InlineAlert, LoadingPanel } from '../components/UiFeedback'
import { useCustomers } from '../hooks/useCustomers'
import { useAuth } from '../lib/auth-context'
import { useShopSettings } from '../lib/shop-settings-context'
import type { Customer } from '../types/customer-status'

const peso = (value: number) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function CustomersPage() {
  const { profile } = useAuth()
  const { settings } = useShopSettings()
  const isOwner = profile?.role === 'owner'
  const canManage = isOwner || settings.staff_can_manage_customers
  const { rows, loading, error, realtimeState, reload } = useCustomers()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('active')
  const [editing, setEditing] = useState<Customer | null | undefined>(undefined)

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (filter === 'active' && !row.active) return false
      if (filter === 'inactive' && row.active) return false
      return !needle || [row.full_name, row.phone_number || '', row.customer_code].some((value) => value.toLowerCase().includes(needle))
    })
  }, [filter, rows, search])

  const totalOutstanding = rows.reduce((sum, row) => sum + Number(row.outstanding_balance || 0), 0)

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600 dark:text-sky-400">Phase 2</p><h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">Customers</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Find repeat customers and review their laundry history in one place.</p></div>
        {canManage && <button type="button" onClick={() => setEditing(null)} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">+ Add customer</button>}
      </section>
      {editing !== undefined && <CustomerForm customer={editing} isOwner={isOwner} onCancel={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void reload() }} onDeleted={() => { setEditing(undefined); void reload() }} />}
      {!canManage && <InlineAlert variant="info" title="Customer changes are disabled">The Owner has turned off Staff customer management. You can still search and review customer records.</InlineAlert>}
      {error && <InlineAlert variant="error" title="Customers could not be refreshed" actionLabel="Try again" onAction={() => void reload()}>{error}</InlineAlert>}
      {!error && (realtimeState === 'error' || realtimeState === 'disconnected') && <InlineAlert variant="warning" title="Live customer sync is temporarily offline" actionLabel="Refresh now" onAction={() => void reload()}>Existing rows remain visible until the connection recovers.</InlineAlert>}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Summary label="Customers" value={String(rows.length)} /><Summary label="Active" value={String(rows.filter((row) => row.active).length)} /><Summary label="Visits" value={String(rows.reduce((sum, row) => sum + Number(row.total_transactions || 0), 0))} /><Summary label="Outstanding" value={peso(totalOutstanding)} warning={totalOutstanding > 0} /></section>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-5"><div className="grid gap-3 sm:grid-cols-[1fr_auto]"><label className="text-xs font-medium text-slate-600 dark:text-slate-400">Search<input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" placeholder="Name, phone, or CUS-ID" /></label><label className="text-xs font-medium text-slate-600 dark:text-slate-400">Show<select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 sm:w-36"><option value="active">Active</option><option value="all">All</option><option value="inactive">Inactive</option></select></label></div></section>
      {loading ? <LoadingPanel label="Loading customers…" slowLabel="Still loading customer records…" /> : filtered.length === 0 ? <EmptyState title={rows.length === 0 ? 'No customers yet' : 'No customers match this search'} description={rows.length === 0 ? 'Add the first canonical customer to start building repeat-customer history.' : 'Try a different name, phone number, or customer ID.'} /> : <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="divide-y divide-slate-200 dark:divide-slate-800">{filtered.map((row) => <Link key={row.id} to={`/customers/${row.id}`} className="block p-4 transition hover:bg-slate-50 dark:hover:bg-slate-800/50 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-slate-900 dark:text-slate-100">{row.full_name}</h2><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{row.customer_code}</span>{!row.active && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">Inactive</span>}</div><p className="mt-1 text-sm text-slate-500">{row.phone_number || 'No phone recorded'}</p></div><div className="text-right"><p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{peso(Number(row.outstanding_balance))}</p><p className="text-xs text-slate-500">outstanding · {row.total_transactions} visit{row.total_transactions === 1 ? '' : 's'}</p><p className="mt-1 text-sm font-semibold text-emerald-700 dark:text-emerald-300">{row.points_balance === null ? '—' : `${Number(row.points_balance).toLocaleString('en-PH', { maximumFractionDigits: 2 })} pts`}</p><p className="text-xs text-slate-500">loyalty balance</p></div></div></Link>)}</div></section>}
    </div>
  )
}

function Summary({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) { return <div className={`rounded-2xl border p-4 ${warning ? 'border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{value}</p></div> }

