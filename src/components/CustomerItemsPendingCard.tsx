import { Link } from 'react-router-dom'
import type { TransactionWithService } from '../types/database'
import { customerItemsHref, CUSTOMER_ITEM_STATUS_LABELS } from '../lib/customer-items-pending'
import BentoCard from './BentoCard'
import { InlineAlert, LoadingPanel } from './UiFeedback'
import UiIcon from './UiIcon'

export default function CustomerItemsPendingCard({
  rows,
  loading,
  error,
  canEdit,
  onRefresh,
}: {
  rows: TransactionWithService[]
  loading: boolean
  error: string | null
  canEdit: boolean
  onRefresh: () => void
}) {
  const description = rows.length === 0
    ? 'All active orders have customer item lists.'
    : `${rows.length} order${rows.length === 1 ? '' : 's'} still need customer item lists`

  return (
    <BentoCard
      title="Customer Items Pending"
      description={description}
      icon="alert"
      tone="amber"
      action={
        <Link
          to="/orders"
          className="inline-flex items-center gap-1 rounded-lg border border-amber-300 px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950/50"
        >
          View all <UiIcon name="arrow-right" size={14} />
        </Link>
      }
    >
      {error && (
        <div className="mb-3">
          <InlineAlert variant="error" title="Pending items could not be refreshed" actionLabel="Try again" onAction={onRefresh}>
            {error}
          </InlineAlert>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <LoadingPanel compact label="Checking customer item lists…" slowLabel="Still checking customer item lists…" />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-amber-300 px-4 py-6 text-center text-sm text-amber-800 dark:border-amber-800 dark:text-amber-200">
          All active orders have customer item lists.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 dark:border-amber-900/70 dark:bg-amber-950/20">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-slate-900 dark:text-slate-100">{row.customer_name}</p>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{row.transaction_code || `#${String(row.transaction_no).padStart(4, '0')}`}</span>
                </div>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{CUSTOMER_ITEM_STATUS_LABELS[row.order_status]}</p>
              </div>
              <Link
                to={customerItemsHref(row.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
              >
                <UiIcon name={canEdit ? 'plus' : 'arrow-right'} size={14} />
                {canEdit ? 'Add Items' : 'View Order'}
              </Link>
            </div>
          ))}
        </div>
      )}
    </BentoCard>
  )
}
