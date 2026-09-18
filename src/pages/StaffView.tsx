import { useEffect, useState } from 'react'
import TransactionForm from '../components/TransactionForm'
import TransactionTable from '../components/TransactionTable'
import EditTransactionModal from '../components/EditTransactionModal'
import DeleteTransactionModal from '../components/DeleteTransactionModal'
import ActionErrorBoundary from '../components/ActionErrorBoundary'
import BentoCard from '../components/BentoCard'
import UiIcon from '../components/UiIcon'
import { InlineAlert } from '../components/UiFeedback'
import { useTransactions } from '../hooks/useTransactions'
import { useAuth } from '../lib/auth-context'
import { shopDate } from '../lib/date'
import type { TransactionWithService } from '../types/database'

export default function StaffView() {
  const { profile } = useAuth()
  const isOwner = profile?.role === 'owner'
  const [todayStr, setTodayStr] = useState(shopDate())
  const [editingTransaction, setEditingTransaction] = useState<TransactionWithService | null>(null)
  const [deletingTransaction, setDeletingTransaction] = useState<TransactionWithService | null>(null)
  const { rows, loading, error, realtimeState, reload } = useTransactions({
    dateFrom: todayStr,
    dateTo: todayStr,
    includeCustomerItemCoverage: true,
  })

  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentShopDate = shopDate()
      setTodayStr((previous) => (previous === currentShopDate ? previous : currentShopDate))
    }, 60_000)

    return () => window.clearInterval(timer)
  }, [])

  const refreshToday = () => {
    const currentShopDate = shopDate()
    if (currentShopDate !== todayStr) {
      setTodayStr(currentShopDate)
      return
    }
    void reload()
  }

  const closeEdit = () => {
    setEditingTransaction(null)
    void reload()
  }

  const closeDelete = () => {
    setDeletingTransaction(null)
    void reload()
  }

  return (
    <>
      <div className="space-y-6">
        <BentoCard title="Today’s operations" description="Capture new laundry orders and keep today’s queue moving." icon="wash" tone="sky">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="rounded-full bg-sky-50 px-2.5 py-1 font-medium text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">{todayStr}</span>
            <span>New orders appear in the live transaction list below.</span>
          </div>
        </BentoCard>

        <TransactionForm onAdded={() => void reload()} />

        <BentoCard
          title="Today’s transactions"
          description={`${todayStr} · ${rows.length} entries · only today’s records are shown`}
          icon="orders"
          action={(
            <button
              type="button"
              onClick={refreshToday}
              disabled={loading}
              aria-label="Refresh today's transactions"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <UiIcon name="refresh" size={16} />
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
        >

          <div className="mb-3 space-y-2">
            {error && (
              <InlineAlert variant="error" title="Transactions could not be refreshed" actionLabel="Try again" onAction={() => void reload()}>
                {error} Your existing screen stays available and no transaction was deleted.
              </InlineAlert>
            )}
            {!error && (realtimeState === 'disconnected' || realtimeState === 'error') && (
              <InlineAlert variant="warning" title="Live sync is temporarily offline" actionLabel="Refresh now" onAction={() => void reload()}>
                You can keep using Aquaspin, but changes from other staff may take longer to appear. Use Refresh until live sync reconnects.
              </InlineAlert>
            )}
          </div>

          <TransactionTable
            rows={rows}
            loading={loading}
            isOwner={isOwner}
            onEdit={setEditingTransaction}
            onDelete={setDeletingTransaction}
          />
        </BentoCard>
      </div>

      {editingTransaction && (
        <ActionErrorBoundary key={`edit-boundary-${editingTransaction.id}`} onClose={closeEdit}>
          <EditTransactionModal key={`edit-${editingTransaction.id}`} transaction={editingTransaction} onClose={closeEdit} />
        </ActionErrorBoundary>
      )}

      {deletingTransaction && (
        <ActionErrorBoundary key={`delete-boundary-${deletingTransaction.id}`} onClose={closeDelete}>
          <DeleteTransactionModal key={`delete-${deletingTransaction.id}`} transaction={deletingTransaction} onClose={closeDelete} />
        </ActionErrorBoundary>
      )}
    </>
  )
}
