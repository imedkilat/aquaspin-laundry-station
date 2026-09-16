import { useEffect, useState } from 'react'
import TransactionForm from '../components/TransactionForm'
import TransactionTable from '../components/TransactionTable'
import EditTransactionModal from '../components/EditTransactionModal'
import DeleteTransactionModal from '../components/DeleteTransactionModal'
import ActionErrorBoundary from '../components/ActionErrorBoundary'
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
  const { rows, loading, error, realtimeState, reload } = useTransactions({ dateFrom: todayStr, dateTo: todayStr })

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
        <TransactionForm onAdded={() => void reload()} />

        <div className="bg-white rounded-2xl border border-slate-200 p-5 dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <div>
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">Today's Transactions</h2>
              <span className="text-xs text-slate-400">
                {todayStr} · {rows.length} entries · only today's records are shown
              </span>
            </div>
            <button
              type="button"
              onClick={refreshToday}
              disabled={loading}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {loading ? 'Refreshing…' : '↻ Refresh'}
            </button>
          </div>

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
        </div>
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
