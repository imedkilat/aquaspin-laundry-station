import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import PaymentBadge from '../components/PaymentBadge'
import { InlineAlert, LoadingPanel } from '../components/UiFeedback'
import { useShopDate } from '../hooks/useShopDate'
import { useTransactions } from '../hooks/useTransactions'
import { useAuth } from '../lib/auth-context'

const peso = (value: number) =>
  `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function HomePage() {
  const { profile } = useAuth()
  const today = useShopDate()
  const isOwner = profile?.role === 'owner'
  const { rows, loading, error, realtimeState, reload } = useTransactions({
    dateFrom: today,
    dateTo: today,
    limit: 200,
  })

  const stats = useMemo(() => {
    const activeRows = rows.filter((row) => !row.deleted_at)
    return {
      sales: activeRows.reduce((sum, row) => sum + (row.total_amount || 0), 0),
      kg: activeRows.reduce((sum, row) => sum + (row.kg || 0), 0),
      orders: activeRows.length,
      receivables: activeRows
        .filter((row) => row.payment_method === 'pay_later')
        .reduce((sum, row) => sum + (row.total_amount || 0), 0),
      recent: activeRows.slice(0, 5),
    }
  }, [rows])

  if (loading && rows.length === 0) {
    return <LoadingPanel label="Opening today's shop view…" slowLabel="Still loading today's laundry activity…" />
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-sky-600 p-5 text-white shadow-sm sm:p-6">
        <p className="text-sm text-sky-100">{today}</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">Good day, {profile?.full_name?.split(' ')[0] || 'Aquaspin'}.</h1>
            <p className="mt-1 max-w-2xl text-sm text-sky-100">Run today's laundry operations from one place. Add orders, check balances, and review recent activity.</p>
          </div>
          <Link to="/new" className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-sky-700 shadow-sm transition hover:bg-sky-50">
            + New Order
          </Link>
        </div>
      </section>

      <div className="space-y-2">
        {error && (
          <InlineAlert variant="error" title="Today's activity could not be refreshed" actionLabel="Try again" onAction={() => void reload()}>
            {error} Existing figures remain visible until the refresh succeeds.
          </InlineAlert>
        )}
        {!error && (realtimeState === 'disconnected' || realtimeState === 'error') && (
          <InlineAlert variant="warning" title="Live sync is temporarily offline" actionLabel="Refresh now" onAction={() => void reload()}>
            Aquaspin is still usable, but changes from another browser may take longer to appear.
          </InlineAlert>
        )}
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Today's Sales" value={peso(stats.sales)} hint={`${stats.orders} orders`} />
        <MetricCard label="Laundry Weight" value={`${stats.kg.toFixed(stats.kg % 1 === 0 ? 0 : 1)} kg`} hint="Processed today" />
        <MetricCard label="Orders" value={String(stats.orders)} hint="Active transactions" />
        <MetricCard label="Pay Later" value={peso(stats.receivables)} hint="Today's receivables" tone={stats.receivables > 0 ? 'warning' : 'default'} />
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <QuickAction to="/new" title="New Order" description="Record a laundry transaction" icon="＋" />
        <QuickAction to="/orders" title="Orders" description="Search and review transactions" icon="⌕" />
        {isOwner ? (
          <QuickAction to="/dashboard" title="Owner Dashboard" description="Reports, exports and shop controls" icon="▦" />
        ) : (
          <QuickAction to="/profile" title="My Profile" description="Review your account details" icon="◎" />
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">Recent Orders</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Latest transactions recorded today</p>
          </div>
          <Link to="/orders" className="text-sm font-medium text-sky-600 hover:text-sky-700 dark:text-sky-400">View all</Link>
        </div>

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
      </section>
    </div>
  )
}

function MetricCard({ label, value, hint, tone = 'default' }: { label: string; value: string; hint: string; tone?: 'default' | 'warning' }) {
  return (
    <div className={`rounded-2xl border bg-white p-4 dark:bg-slate-900 ${tone === 'warning' ? 'border-amber-200 dark:border-amber-900' : 'border-slate-200 dark:border-slate-800'}`}>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold sm:text-2xl ${tone === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-slate-900 dark:text-slate-100'}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-400">{hint}</p>
    </div>
  )
}

function QuickAction({ to, title, description, icon }: { to: string; title: string; description: string; icon: string }) {
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-sky-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-800">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-xl font-semibold text-sky-700 transition group-hover:bg-sky-100 dark:bg-sky-950 dark:text-sky-300">{icon}</span>
      <span className="min-w-0">
        <span className="block font-medium text-slate-900 dark:text-slate-100">{title}</span>
        <span className="block text-xs text-slate-500 dark:text-slate-400">{description}</span>
      </span>
    </Link>
  )
}
