import { Link } from 'react-router-dom'
import type { OnHoldTransaction } from '../hooks/useOnHoldTransactions'
import BentoCard from './BentoCard'
import { InlineAlert, LoadingPanel } from './UiFeedback'
import UiIcon from './UiIcon'

export default function OnHoldHomeCard({
  rows,
  loading,
  error,
  onRefresh,
}: {
  rows: OnHoldTransaction[]
  loading: boolean
  error: string | null
  onRefresh: () => void
}) {
  if (rows.length === 0 && !error) return null

  return (
    <BentoCard
      title="Orders On Hold"
      description={rows.length ? `${rows.length} order${rows.length === 1 ? '' : 's'} need attention` : 'On Hold status could not be verified'}
      icon="alert"
      tone="amber"
      action={
        <Link
          to="/orders"
          className="inline-flex items-center gap-1 rounded-lg border border-amber-300 px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950/50"
        >
          View orders <UiIcon name="arrow-right" size={14} />
        </Link>
      }
    >
      {error && (
        <div className="mb-3">
          <InlineAlert variant="error" title="On Hold notifications could not be refreshed" actionLabel="Try again" onAction={onRefresh}>
            {error}
          </InlineAlert>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <LoadingPanel compact label="Checking On Hold orders…" slowLabel="Still checking On Hold orders…" />
      ) : rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((row) => (
            <Link
              key={row.id}
              to={`/orders/${row.id}`}
              className="block rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 transition hover:border-amber-300 hover:bg-amber-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-900/70 dark:bg-amber-950/20 dark:hover:bg-amber-950/40"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 dark:text-slate-100">{row.customer_name}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{row.transaction_code || `#${String(row.transaction_no).padStart(4, '0')}`}</p>
                </div>
                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700 dark:bg-orange-950 dark:text-orange-300">On Hold</span>
              </div>
              <p className="mt-2 text-sm text-amber-950 dark:text-amber-100"><span className="font-semibold">Reason:</span> {row.reason || 'No reason recorded.'}</p>
            </Link>
          ))}
        </div>
      ) : null}
    </BentoCard>
  )
}
