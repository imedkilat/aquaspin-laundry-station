import { useState } from 'react'
import type { TransactionWithService } from '../types/database'
import { supabase } from '../lib/supabase'
import PaymentBadge from './PaymentBadge'
import EditTransactionModal from './EditTransactionModal'
import DeleteTransactionModal from './DeleteTransactionModal'

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// pickup_time comes back from Postgres as "HH:MM:SS" (24h). Render it as a
// friendly 12h time; fall back gracefully if the format is ever unexpected.
const formatPickupTime = (time: string) => {
  const [hoursStr, minutesStr] = time.split(':')
  const hours = Number(hoursStr)
  const minutes = Number(minutesStr)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return time
  const period = hours >= 12 ? 'PM' : 'AM'
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return `${hour12}:${String(minutes).padStart(2, '0')} ${period}`
}

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })

export default function TransactionTable({
  rows,
  loading,
  isOwner = false,
}: {
  rows: TransactionWithService[]
  loading: boolean
  // Who entered / last edited / deleted a row is only shown to owners --
  // staff can't see other staff's profile rows under RLS anyway (they can
  // only ever see their own), so this keeps the column meaningful rather
  // than showing blanks for anyone but the owner.
  isOwner?: boolean
}) {
  const [editingTransaction, setEditingTransaction] = useState<TransactionWithService | null>(null)
  const [deletingTransaction, setDeletingTransaction] = useState<TransactionWithService | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const restore = async (id: string) => {
    setRestoringId(id)
    await supabase
      .from('transactions')
      .update({ deleted_at: null, deleted_by: null, delete_reason: null })
      .eq('id', id)
    setRestoringId(null)
  }

  if (loading) {
    return <p className="text-sm text-slate-400 py-8 text-center">Loading…</p>
  }

  if (rows.length === 0) {
    return <p className="text-sm text-slate-400 py-8 text-center">No transactions yet.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800">
            <th className="py-2 pr-3 font-medium">Transaction ID</th>
            <th className="py-2 pr-3 font-medium">Date</th>
            <th className="py-2 pr-3 font-medium">Customer</th>
            <th className="py-2 pr-3 font-medium">Phone</th>
            <th className="py-2 pr-3 font-medium">Service</th>
            <th className="py-2 pr-3 font-medium">Kg</th>
            <th className="py-2 pr-3 font-medium">Loads</th>
            <th className="py-2 pr-3 font-medium">Total</th>
            <th className="py-2 pr-3 font-medium">Payment</th>
            <th className="py-2 pr-3 font-medium">Pickup</th>
            {isOwner && <th className="py-2 pr-3 font-medium">Entered By</th>}
            <th className="py-2 pr-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isDeleted = Boolean(r.deleted_at)
            return (
              <tr
                key={r.id}
                className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${
                  isDeleted
                    ? 'bg-red-50/40 dark:bg-red-950/10'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <td className="py-2 pr-3 font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
                  {r.transaction_code || `#${String(r.transaction_no).padStart(4, '0')}`}
                </td>
                <td className="py-2 pr-3">{r.transaction_date}</td>
                <td className="py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">
                  <span className={isDeleted ? 'line-through text-slate-400 dark:text-slate-500' : ''}>
                    {r.customer_name}
                  </span>
                  {isDeleted && (
                    <p className="mt-1 text-[11px] font-normal text-red-600 dark:text-red-400 whitespace-normal max-w-xs">
                      Deleted by {r.deleted_by_profile?.full_name ?? 'someone'}
                      {r.deleted_at && ` · ${formatDateTime(r.deleted_at)}`}
                      {r.delete_reason && ` · "${r.delete_reason}"`}
                    </p>
                  )}
                </td>
                <td className="py-2 pr-3 text-slate-500">{r.phone_number || '—'}</td>
                <td className="py-2 pr-3">{r.services?.code || '—'}</td>
                <td className="py-2 pr-3">{r.kg ?? '—'}</td>
                <td className="py-2 pr-3">{r.no_of_loads ?? '—'}</td>
                <td className="py-2 pr-3 font-medium">{peso(r.total_amount)}</td>
                <td className="py-2 pr-3">
                  <PaymentBadge method={r.payment_method} />
                  {r.payment_method === 'gcash' && (
                    <p className="mt-1 text-[11px] text-slate-500 whitespace-nowrap">
                      Ref: {r.gcash_reference || 'Legacy / not recorded'}
                    </p>
                  )}
                </td>
                <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">
                  {r.pickup_date ? (
                    <>
                      {r.pickup_date}
                      {r.pickup_time && <span className="text-slate-400"> · {formatPickupTime(r.pickup_time)}</span>}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                {isOwner && (
                  <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">
                    {r.created_by_profile?.full_name ?? '—'}
                    {r.updated_by_profile?.full_name && r.updated_by_profile.full_name !== r.created_by_profile?.full_name && (
                      <p className="mt-0.5 text-[11px] text-slate-400">Edited by {r.updated_by_profile.full_name}</p>
                    )}
                  </td>
                )}
                <td className="py-2 pr-3 whitespace-nowrap">
                  {isDeleted ? (
                    <button
                      type="button"
                      onClick={() => restore(r.id)}
                      disabled={restoringId === r.id}
                      className="text-emerald-600 hover:text-emerald-700 text-xs font-medium disabled:opacity-50"
                    >
                      {restoringId === r.id ? 'Restoring…' : '↺ Restore'}
                    </button>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setEditingTransaction(r)}
                        className="text-sky-600 hover:text-sky-700 text-xs font-medium"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingTransaction(r)}
                        className="text-red-600 hover:text-red-700 text-xs font-medium"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {editingTransaction && (
        <EditTransactionModal transaction={editingTransaction} onClose={() => setEditingTransaction(null)} />
      )}
      {deletingTransaction && (
        <DeleteTransactionModal transaction={deletingTransaction} onClose={() => setDeletingTransaction(null)} />
      )}
    </div>
  )
}
