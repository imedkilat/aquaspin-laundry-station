import { useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { isDropOffTransaction } from '../lib/service-classification'
import type { OrderStatus, TransactionStatusHistory } from '../types/customer-status'
import type { TransactionWithService } from '../types/database'
import { ButtonSpinner, InlineAlert } from './UiFeedback'

export type TransactionStatusHistoryWithActor = TransactionStatusHistory & {
  changed_by_profile: { full_name: string } | null
}

const STATUS_ORDER: OrderStatus[] = ['received', 'washing', 'drying', 'ready_for_pickup', 'completed']

const STATUS_LABELS: Record<OrderStatus, string> = {
  received: 'Received',
  washing: 'Washing',
  drying: 'Drying',
  ready_for_pickup: 'Ready for Pickup',
  completed: 'Completed',
  on_hold: 'On Hold',
  cancelled: 'Cancelled',
}

const STATUS_STYLES: Record<OrderStatus, string> = {
  received: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  washing: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  drying: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  ready_for_pickup: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  completed: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  on_hold: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
}

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}>{STATUS_LABELS[status]}</span>
}

export default function TransactionStatusPanel({
  transaction,
  hasCustomerItems,
  history,
  canEdit,
  isOwner,
  onRefresh,
}: {
  transaction: TransactionWithService
  hasCustomerItems: boolean
  history: TransactionStatusHistoryWithActor[]
  canEdit: boolean
  isOwner: boolean
  onRefresh: () => Promise<void>
}) {
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus>('on_hold')
  const [reason, setReason] = useState('')
  const [reasonAction, setReasonAction] = useState<'hold' | 'cancel' | null>(null)
  const [override, setOverride] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentStatus = transaction.order_status
  const currentIndex = STATUS_ORDER.indexOf(currentStatus)
  const nextStatus = currentIndex >= 0 ? STATUS_ORDER[currentIndex + 1] : null
  const isTerminal = currentStatus === 'completed' || currentStatus === 'cancelled'
  const requiresCustomerItems = isDropOffTransaction(transaction)
  const completionBlocked = requiresCustomerItems && !hasCustomerItems && !isTerminal
  const availableOverrideStatuses = useMemo(
    () => (Object.keys(STATUS_LABELS) as OrderStatus[]).filter((status) => status !== currentStatus && (status !== 'completed' || !requiresCustomerItems || hasCustomerItems)),
    [currentStatus, hasCustomerItems, requiresCustomerItems],
  )

  const changeStatus = async (status: OrderStatus, useOverride = false, actionReason = '') => {
    if (!canEdit || busy || transaction.deleted_at) return
    if (status === 'completed' && requiresCustomerItems && !hasCustomerItems) {
      setError("Please record the customer's item list before completing this order.")
      return
    }
    setBusy(true)
    setError(null)

    const { error: rpcError } = await supabase.rpc('set_transaction_status', {
      p_transaction_id: transaction.id,
      p_status: status,
      p_expected_updated_at: transaction.updated_at,
      p_reason: actionReason.trim() || null,
      p_override: useOverride,
    })

    setBusy(false)

    if (rpcError) {
      setError(rpcError.message || 'The order status could not be changed. Refresh and try again.')
      return
    }

    setReason('')
    setReasonAction(null)
    setOverride(false)
    await onRefresh()
  }

  const submitSelected = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const targetStatus = reasonAction === 'cancel'
      ? 'cancelled'
      : reasonAction === 'hold' ? 'on_hold' : selectedStatus
    await changeStatus(targetStatus, override, reason)
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Laundry Status</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Status changes are checked and recorded by Aquaspin.</p>
        </div>
        <StatusBadge status={currentStatus} />
      </div>

      {error && <div className="mt-4"><InlineAlert variant="error" title="Status change did not finish">{error}</InlineAlert></div>}

      {completionBlocked && canEdit && (
        <div className="mt-4">
          <InlineAlert variant="warning" title="Customer item list required">
            Please record the customer's item list before completing this order.
          </InlineAlert>
        </div>
      )}

      {!transaction.deleted_at && canEdit && !isTerminal && (
        <div className="mt-4 flex flex-wrap gap-2">
          {nextStatus && (
            <button
              type="button"
              onClick={() => void changeStatus(nextStatus)}
              disabled={busy || (nextStatus === 'completed' && requiresCustomerItems && !hasCustomerItems)}
              className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
            >
              {busy && <ButtonSpinner />}
              Move to {STATUS_LABELS[nextStatus]}
            </button>
          )}
          {currentStatus !== 'on_hold' && (
            <button
              type="button"
              onClick={() => { setReasonAction('hold'); setOverride(false) }}
              disabled={busy}
              className="rounded-xl border border-amber-300 px-3.5 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40"
            >
              Put on Hold
            </button>
          )}
          <button
            type="button"
              onClick={() => { setReasonAction('cancel'); setOverride(false) }}
            disabled={busy}
            className="rounded-xl border border-red-300 px-3.5 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            Cancel Order
          </button>
        </div>
      )}

      {!transaction.deleted_at && canEdit && !override && (reasonAction !== null || currentStatus === 'on_hold') && !isTerminal && (
        <form onSubmit={submitSelected} className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_1fr_auto] sm:items-end">
            <div>
              <label htmlFor="status-action" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Status action</label>
              <select id="status-action" value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value as OrderStatus)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                {reasonAction === 'cancel' && <option value="cancelled">Cancel Order</option>}
                {reasonAction !== 'cancel' && currentStatus === 'on_hold' && STATUS_ORDER.slice(0, -1).map((status) => <option key={status} value={status}>Resume to {STATUS_LABELS[status]}</option>)}
                {reasonAction !== 'cancel' && currentStatus !== 'on_hold' && <option value="on_hold">Put on Hold</option>}
              </select>
            </div>
            <div>
              <label htmlFor="status-reason" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Reason <span className="text-red-500">*</span></label>
              <input id="status-reason" value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={500} placeholder="What happened?" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-900" />
            </div>
            <button type="submit" disabled={busy || !reason.trim()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-800 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white">
              {busy && <ButtonSpinner />}
              Apply status
            </button>
          </div>
        </form>
      )}

      {isOwner && !transaction.deleted_at && (
        <form onSubmit={submitSelected} className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400">
            <input type="checkbox" checked={override} onChange={(event) => { setOverride(event.target.checked); setReasonAction(null); if (event.target.checked) { setReason(''); setSelectedStatus(nextStatus || 'received') } }} />
            Owner override
          </label>
          {override && (
            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,220px)_1fr_auto] sm:items-end">
              <div>
                <label htmlFor="owner-status" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Change status to</label>
                <select id="owner-status" value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value as OrderStatus)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                  {availableOverrideStatuses.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="owner-status-reason" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Override reason <span className="text-red-500">*</span></label>
                <input id="owner-status-reason" value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={500} placeholder="Explain the exception" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-900" />
              </div>
              <button type="submit" disabled={busy || !reason.trim()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                {busy && <ButtonSpinner />}
                Apply override
              </button>
            </div>
          )}
        </form>
      )}

      {!canEdit && <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">Status updates are disabled by the Owner for your account.</p>}

      <div className="mt-5 border-t border-slate-100 pt-5 dark:border-slate-800">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Status history</h3>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No status history is available.</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {history.map((entry) => (
              <li key={entry.id} className="relative rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-950">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    {entry.previous_status && <><StatusBadge status={entry.previous_status} /><span className="text-slate-400">→</span></>}
                    <StatusBadge status={entry.new_status} />
                  </div>
                  <time className="text-xs text-slate-400" dateTime={entry.changed_at}>{formatDateTime(entry.changed_at)}</time>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Changed by {entry.changed_by_profile?.full_name || 'System'}</p>
                {entry.reason && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Reason: {entry.reason}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
