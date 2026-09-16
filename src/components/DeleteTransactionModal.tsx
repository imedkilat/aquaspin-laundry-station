import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { TransactionWithService } from '../types/database'

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// A soft delete only sends the deletion timestamp + reason. Postgres assigns
// deleted_by from auth.uid(), so a browser/direct API caller cannot spoof who
// deleted the transaction.
export default function DeleteTransactionModal({
  transaction,
  onClose,
}: {
  transaction: TransactionWithService
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const deleteLockRef = useRef(false)

  const handleDelete = async () => {
    if (deleteLockRef.current) return
    deleteLockRef.current = true

    try {
      const trimmedReason = reason.trim()
      if (trimmedReason.length < 3) {
        setError('Enter a short reason (at least 3 characters) before deleting.')
        return
      }

      setError(null)
      setDeleting(true)

      const { error: updateError } = await supabase
        .from('transactions')
        .update({
          deleted_at: new Date().toISOString(),
          delete_reason: trimmedReason,
        })
        .eq('id', transaction.id)

      setDeleting(false)

      if (updateError) {
        setError(updateError.message)
        return
      }

      onClose()
    } finally {
      deleteLockRef.current = false
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 space-y-4 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Delete Transaction</h2>
          <p className="text-sm text-slate-500 mt-1">
            {transaction.transaction_code || `#${String(transaction.transaction_no).padStart(4, '0')}`} ·{' '}
            {transaction.customer_name} · {peso(transaction.total_amount)}
          </p>
        </div>

        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400">
          This removes it from the transaction list, but the record is kept with your account, the time, and this
          reason, so the owner can review it later.
        </p>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Reason for deleting *</label>
          <textarea
            required
            autoFocus
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Entered twice by mistake, duplicate of AQ-XXXXXXXX"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-medium rounded-lg px-4 py-2 text-sm transition"
          >
            {deleting ? 'Deleting…' : 'Delete Transaction'}
          </button>
        </div>
      </div>
    </div>
  )
}
