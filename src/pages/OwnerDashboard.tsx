import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTransactions } from '../hooks/useTransactions'
import { useProfiles } from '../hooks/useProfiles'
import { useServices } from '../hooks/useServices'
import { supabase } from '../lib/supabase'
import TransactionTable from '../components/TransactionTable'
import StatCard from '../components/StatCard'
import type { PaymentMethod, Profile, Role, Service } from '../types/database'
import { useAuth } from '../lib/auth-context'
import { shopDate, shopDateDaysAgo } from '../lib/date'

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Tab = 'overview' | 'staff' | 'pricing'

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
        <button onClick={() => setTab('overview')} className={tabClass(tab === 'overview')}>
          Overview
        </button>
        <button onClick={() => setTab('staff')} className={tabClass(tab === 'staff')}>
          Staff Accounts
        </button>
        <button onClick={() => setTab('pricing')} className={tabClass(tab === 'pricing')}>
          Service Pricing
        </button>
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
                  <option value="paid">Cash</option>
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
      )}

      {tab === 'staff' && <StaffAccounts />}
      {tab === 'pricing' && <ServicePricing />}
    </div>
  )
}

function StaffAccounts() {
  const { profiles, loading, reload } = useProfiles()
  const { profile: currentProfile } = useAuth()
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const ownerProfiles = useMemo(() => profiles.filter((profile) => profile.role === 'owner'), [profiles])
  const staffProfiles = useMemo(() => profiles.filter((profile) => profile.role === 'staff'), [profiles])

  const createStaff = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    setCreating(true)

    const { data, error: functionError } = await supabase.functions.invoke('create-staff-user', {
      body: {
        full_name: fullName.trim(),
        email: email.trim(),
        password,
      },
    })

    setCreating(false)

    if (functionError) {
      setError(functionError.message)
      return
    }

    if (data?.error) {
      setError(String(data.error))
      return
    }

    setSuccess(`Staff account created for ${email.trim()}.`)
    setFullName('')
    setEmail('')
    setPassword('')
    reload()
    window.setTimeout(reload, 800)
  }

  const toggleRole = async (id: string, current: Role) => {
    setUpdatingId(id)
    setError(null)
    setSuccess(null)
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
    <div className="space-y-5">
      <form onSubmit={createStaff} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 dark:bg-slate-900 dark:border-slate-800">
        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Create Staff Credentials</h2>
          <p className="text-sm text-slate-500 mt-1">
            Owner-only. New accounts are created directly as Staff and can sign in immediately.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Staff Name</label>
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Juan Dela Cruz"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Login Email</label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="staff@aquaspin.ph"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Temporary Password</label>
            <input
              required
              minLength={8}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="At least 8 characters"
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        {success && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{success}</p>}

        <button
          type="submit"
          disabled={creating}
          className="bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-medium rounded-lg px-4 py-2 text-sm transition"
        >
          {creating ? 'Creating…' : 'Create Staff Account'}
        </button>
      </form>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5 dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">Account Access</h2>
            <p className="text-sm text-slate-500 mt-1">Owners and staff are separated below for easier access review.</p>
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

        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="space-y-5">
            <AccessGroup
              title="Owner Access"
              profiles={ownerProfiles}
              currentProfileId={currentProfile?.id}
              updatingId={updatingId}
              onToggleRole={toggleRole}
              emptyText="No owner accounts found."
            />
            <AccessGroup
              title="Staff Access"
              profiles={staffProfiles}
              currentProfileId={currentProfile?.id}
              updatingId={updatingId}
              onToggleRole={toggleRole}
              emptyText="No staff accounts yet. Create one above, then use Refresh if needed."
            />
          </div>
        )}
      </div>
    </div>
  )
}

function AccessGroup({
  title,
  profiles,
  currentProfileId,
  updatingId,
  onToggleRole,
  emptyText,
}: {
  title: string
  profiles: Profile[]
  currentProfileId?: string
  updatingId: string | null
  onToggleRole: (id: string, current: Role) => void
  emptyText: string
}) {
  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-medium text-slate-900 dark:text-slate-100">{title}</h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {profiles.length}
        </span>
      </div>

      {profiles.length === 0 ? (
        <p className="text-sm text-slate-400 py-2">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Role</th>
                <th className="py-2 pr-3 font-medium">Since</th>
                <th className="py-2 pr-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">{profile.full_name}</td>
                  <td className="py-2 pr-3 capitalize">{profile.role}</td>
                  <td className="py-2 pr-3 text-slate-500">{new Date(profile.created_at).toLocaleDateString()}</td>
                  <td className="py-2 pr-3">
                    <button
                      disabled={
                        updatingId === profile.id ||
                        (profile.id === currentProfileId && profile.role === 'owner')
                      }
                      onClick={() => onToggleRole(profile.id, profile.role)}
                      className="text-sky-600 hover:text-sky-700 text-xs font-medium disabled:opacity-50"
                    >
                      {profile.id === currentProfileId && profile.role === 'owner'
                        ? 'Current Owner'
                        : profile.role === 'owner'
                          ? 'Demote to Staff'
                          : 'Promote to Owner'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ServicePricing() {
  const { services, loading, reload } = useServices()

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 dark:bg-slate-900 dark:border-slate-800">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Service Pricing</h2>
          <p className="text-sm text-slate-500 mt-1">
            Change the price per load here. Every service uses the 8 kg/load rule, and open staff screens sync automatically.
          </p>
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

      {loading ? (
        <p className="text-sm text-slate-400 py-6 text-center">Loading services…</p>
      ) : (
        <div className="space-y-3">
          {services.map((service) => (
            <ServiceRateRow key={service.id} service={service} onSaved={reload} />
          ))}
        </div>
      )}
    </div>
  )
}

function ServiceRateRow({ service, onSaved }: { service: Service; onSaved: () => void }) {
  const [rate, setRate] = useState(service.default_rate == null ? '' : String(service.default_rate))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setRate(service.default_rate == null ? '' : String(service.default_rate))
  }, [service.default_rate])

  const save = async () => {
    const nextRate = Number(rate)
    if (!Number.isFinite(nextRate) || nextRate < 0) {
      setMessage('Enter a valid non-negative rate.')
      return
    }

    setSaving(true)
    setMessage(null)
    const { error } = await supabase.from('services').update({ default_rate: nextRate }).eq('id', service.id)
    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage('Saved. Staff pricing will sync automatically.')
    onSaved()
  }

  return (
    <div className="rounded-xl border border-slate-200 p-4 flex flex-col md:flex-row md:items-center gap-3 dark:border-slate-700">
      <div className="flex-1">
        <p className="font-medium text-slate-900 dark:text-slate-100">{service.label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{service.code} · 8 kg per load</p>
      </div>
      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Price / load (₱)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-medium rounded-lg px-4 py-2 text-sm transition"
        >
          {saving ? 'Saving…' : 'Save Price'}
        </button>
      </div>
      {message && <p className="text-xs text-slate-500 md:w-56">{message}</p>}
    </div>
  )
}
