import { Link } from 'react-router-dom'
import type { LoyaltyRewardHomeNotification } from '../hooks/useLoyaltyRewardNotifications'
import BentoCard from './BentoCard'
import { InlineAlert, LoadingPanel } from './UiFeedback'
import UiIcon from './UiIcon'

const points = (value: number) => Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })

export default function LoyaltyRewardHomeCard({
  rows,
  loading,
  error,
  isOwner,
  onRefresh,
}: {
  rows: LoyaltyRewardHomeNotification[]
  loading: boolean
  error: string | null
  isOwner: boolean
  onRefresh: () => void
}) {
  // Match the other Home alert cards: no empty warning block when nothing is
  // waiting for attention, but keep an error visible so staleness is honest.
  if (rows.length === 0 && !error) return null

  return (
    <BentoCard
      title="Loyalty Rewards Need Attention"
      description={rows.length ? `${rows.length} customer${rows.length === 1 ? '' : 's'} qualified for a reward` : 'Loyalty reward status could not be verified'}
      icon="gift"
      tone="amber"
      action={
        isOwner ? (
          <Link
            to="/dashboard?tab=loyalty"
            className="inline-flex items-center gap-1 rounded-lg border border-amber-300 px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950/50"
          >
            Open Loyalty <UiIcon name="arrow-right" size={14} />
          </Link>
        ) : undefined
      }
    >
      {error && (
        <div className="mb-3">
          <InlineAlert variant="error" title="Loyalty reward notifications could not be refreshed" actionLabel="Try again" onAction={onRefresh}>
            {error}
          </InlineAlert>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <LoadingPanel compact label="Checking loyalty rewards…" slowLabel="Still checking loyalty rewards…" />
      ) : rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 dark:border-amber-900/70 dark:bg-amber-950/20"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 dark:text-slate-100">{row.customer_name} is now qualified for a Reward.</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {row.customer_code ? `${row.customer_code} · ` : ''}Qualified {new Date(row.created_at).toLocaleString('en-PH')}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700 dark:bg-orange-950 dark:text-orange-300">
                  {points(row.current_points_balance)} / {points(row.points_required_for_reward)} points
                </span>
              </div>
              <p className="mt-2 text-sm text-amber-950 dark:text-amber-100">
                <span className="font-semibold">Reward:</span> {row.reward_description}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link
                  to={`/customers/${row.customer_id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950/50"
                >
                  <UiIcon name="customers" size={14} /> View customer
                </Link>
                {isOwner && (
                  <Link
                    to="/dashboard?tab=loyalty"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
                  >
                    <UiIcon name="gift" size={14} /> Open Loyalty & Redeem
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </BentoCard>
  )
}
