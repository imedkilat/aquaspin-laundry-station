import { useMemo, useState } from 'react'
import { useTransactions } from '../hooks/useTransactions'
import { useProfiles } from '../hooks/useProfiles'
import { supabase } from '../lib/supabase'
import TransactionTable from '../components/TransactionTable'
import StatCard from '../components/StatCard'
import type { PaymentMethod, Role } from '../types/database'
import { useAuth } from '../lib/auth-context'
import { shopDate, shopDateDaysAgo } from '../lib/date'

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Tab = 'overview' | 'staff'

export default function OwnerDashboard() {
  const [tab, setTab] = useState<Tab>('overview')
  const [dateFrom, setDateFrom] = useState(shopDateDaysAgo(6))
  const [dateTo, setDateTo] = useState(shopDate())
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | 'all'>('all')
  const [search, setSearch] = useState('')

  const { rows, loading } = useTransactions({ dateFrom, dateTo, limit: 1000 })

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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setTab('overview')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
            tab === 'overview' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 border border-slate-200'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setTab('staff')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
            tab === 'staff' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 border border-slate-200'
          }`}
        >
          Staff Accounts
        </button>
      </div>

      {tab === 'overview' ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Today's Revenue" value={peso(stats.revenueToday)} hint={`${stats.countToday} transactions`} />
            <StatCard label="Revenue (selected range)" value={peso(stats.revenueRange)} />
            <StatCard label="Pay Later — count" value={String(stats.payLaterCount)} hint="in selected range" />
            <StatCard label="Pay Later — outstanding" value={peso(stats.payLaterTotal)} />
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Payment</label>
                <select
                  value={methodFilter}
                  onChange={(e) => setMethodFilter(e.target.value as PaymentMethod | 'all')}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                >
                  <option value="all">All</option>
                  <option value="paid">Paid</option>
                  <option value="gcash">GCash</option>
                  <option value="pay_later">Pay Later</option>
                </select>
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs font-medium text-slate-600 mb-1">Search customer</label>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
            </div>

            <TransactionTable rows={filtered} loading={loading} />
          </div>
        </>
      ) : (
        <StaffAccounts />
      )}
    </div>
  )
}

function StaffAccounts() {
  const { profiles, loading, reload } = useProfiles()
  const { profile: currentProfile } = useAuth()
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggleRole = async (id: string, current: Role) => {
    setUpdatingId(id)
    setError(null)
    const next: Role = current === 'owner' ? 'staff' : 'owner'
    const { error } = await supabase.from('profiles').update({ role: next }).eq('id', id)
    setUpdatingId(null)
    if (error) {
      setError(error.message)
      return
    }
    reload()
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-slate-900">Staff Accounts</h2>
        <p className="text-sm text-slate-500 mt-1">
          To add a new staff member: create their login in your Supabase project (Authentication → Add user),
          then set their role here. New accounts default to "Staff".
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium">Role</th>
              <th className="py-2 pr-3 font-medium">Since</th>
              <th className="py-2 pr-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-3 font-medium text-slate-900">{p.full_name}</td>
                <td className="py-2 pr-3 capitalize">{p.role}</td>
                <td className="py-2 pr-3 text-slate-500">{new Date(p.created_at).toLocaleDateString()}</td>
                <td className="py-2 pr-3">
                  <button
                    disabled={updatingId === p.id || (p.id === currentProfile?.id && p.role === 'owner')}
                    onClick={() => toggleRole(p.id, p.role)}
                    className="text-sky-600 hover:text-sky-700 text-xs font-medium disabled:opacity-50"
                  >
                    {p.id === currentProfile?.id && p.role === 'owner'
                      ? 'Current Owner'
                      : p.role === 'owner'
                        ? 'Demote to Staff'
                        : 'Promote to Owner'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
