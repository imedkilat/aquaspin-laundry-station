import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { TransactionServiceItem, TransactionWithService } from '../types/database'
import type { OrderStatus } from '../types/customer-status'
import { supabase } from '../lib/supabase'
import { useShopSettings } from '../lib/shop-settings-context'
import PaymentBadge from './PaymentBadge'
import EditTransactionModal from './EditTransactionModal'
import DeleteTransactionModal from './DeleteTransactionModal'
import { ButtonSpinner, EmptyState, InlineAlert, LoadingPanel } from './UiFeedback'
import { writeReceiptDocument } from '../lib/receipt'
import { getShopLogoUrl } from '../lib/storage-images'
import { customerItemsHref, isCustomerItemsPending } from '../lib/customer-items-pending'
import UiIcon from './UiIcon'
import { canEditTransaction } from '../lib/transaction-edit'

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

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

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  received: 'Received',
  washing: 'Washing',
  drying: 'Drying',
  ready_for_pickup: 'Ready for Pickup',
  completed: 'Completed',
  on_hold: 'On Hold',
  cancelled: 'Cancelled',
}

const ORDER_STATUS_CLASSES: Record<OrderStatus, string> = {
  received: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  washing: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
  drying: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300',
  ready_for_pickup: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  on_hold: 'bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
}

type TransactionTableProps = {
  rows: TransactionWithService[]
  loading: boolean
  isOwner?: boolean
  onEdit?: (transaction: TransactionWithService) => void
  onDelete?: (transaction: TransactionWithService) => void
}

export default function TransactionTable({ rows, loading, isOwner = false, onEdit, onDelete }: TransactionTableProps) {
  const { settings } = useShopSettings()
  const [editingTransaction, setEditingTransaction] = useState<TransactionWithService | null>(null)
  const [deletingTransaction, setDeletingTransaction] = useState<TransactionWithService | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  const canEdit = isOwner || settings.staff_can_edit_transactions
  const canDelete = isOwner || settings.staff_can_delete_transactions
  const hasActions = true

  const restore = async (id: string) => {
    if (!isOwner) return
    setRestoringId(id)
    setRestoreError(null)
    const { error } = await supabase
      .from('transactions')
      .update({ deleted_at: null, deleted_by: null, delete_reason: null })
      .eq('id', id)
    setRestoringId(null)

    if (error) setRestoreError('Could not restore this transaction. Refresh the page and try again.')
  }

  const openEdit = (transaction: TransactionWithService) => {
    if (!canEdit || !canEditTransaction(transaction.order_status, Boolean(transaction.deleted_at))) return
    if (onEdit) return onEdit(transaction)
    setEditingTransaction(transaction)
  }

  const openDelete = (transaction: TransactionWithService) => {
    if (!canDelete) return
    if (onDelete) return onDelete(transaction)
    setDeletingTransaction(transaction)
  }

  const printReceipt = (transaction: TransactionWithService) => {
    // The window must open synchronously, in direct response to this click,
    // or popup blockers (Safari especially) will silently swallow it. The
    // transaction's additional service lines are only known after an async
    // fetch, so the window opens first (blank) and is filled in once ready.
    const receiptWindow = window.open('', '_blank', 'width=480,height=760')
    if (!receiptWindow) {
      setRestoreError('Could not open the receipt preview. Allow popups for Aquaspin, then try again.')
      return
    }

    void supabase
      .from('transaction_service_items')
      .select('*')
      .eq('transaction_id', transaction.id)
      .order('position', { ascending: true })
      .then(({ data, error: fetchError }) => {
        const serviceItems = fetchError ? [] : ((data as unknown as TransactionServiceItem[]) ?? [])
        try {
          writeReceiptDocument(receiptWindow, {
            transaction,
            serviceItems,
            shopName: settings.shop_display_name,
            address: settings.address,
            contactPhone: settings.contact_phone,
            logoUrl: getShopLogoUrl(settings.logo_path),
            reportFooter: settings.report_footer,
          })
        } catch {
          setRestoreError('Could not open the receipt preview. Allow popups for Aquaspin, then try again.')
        }
      })
  }

  if (loading) {
    return <LoadingPanel label="Loading transactions…" slowLabel="Still loading transactions… the internet connection may be slow." />
  }

  if (rows.length === 0) {
    return <EmptyState title="No transactions to show" description="New transactions matching this view will appear here automatically." />
  }

  return (
    <>
      {restoreError && (
        <div className="mb-3">
          <InlineAlert variant="error" title="Restore did not finish">{restoreError}</InlineAlert>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800">
              <th className="py-2 pr-3 font-medium">Transaction ID</th><th className="py-2 pr-3 font-medium">Date</th><th className="py-2 pr-3 font-medium">Customer</th><th className="py-2 pr-3 font-medium">Phone</th><th className="py-2 pr-3 font-medium">Service</th><th className="py-2 pr-3 font-medium">Kg</th><th className="py-2 pr-3 font-medium">Loads</th><th className="py-2 pr-3 font-medium">Total</th><th className="py-2 pr-3 font-medium">Payment</th><th className="py-2 pr-3 font-medium">Order Status</th><th className="py-2 pr-3 font-medium">Pickup</th>{isOwner && <th className="py-2 pr-3 font-medium">Entered By</th>}{hasActions && <th className="py-2 pr-3 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isDeleted = Boolean(r.deleted_at)
              return (
                <tr key={r.id} className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${isDeleted ? 'bg-red-50/40 dark:bg-red-950/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}>
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">
                    <Link to={`/orders/${r.id}`} className="text-sky-600 hover:text-sky-700 hover:underline dark:text-sky-400 dark:hover:text-sky-300">
                      {r.transaction_code || `#${String(r.transaction_no).padStart(4, '0')}`}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">{r.transaction_date}</td>
                  <td className="py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">
                    <span className={isDeleted ? 'line-through text-slate-400 dark:text-slate-500' : ''}>{r.customer_name}</span>
                    {isDeleted && <p className="mt-1 text-[11px] font-normal text-red-600 dark:text-red-400 whitespace-normal max-w-xs">Deleted by {r.deleted_by_profile?.full_name ?? 'someone'}{r.deleted_at && ` · ${formatDateTime(r.deleted_at)}`}{r.delete_reason && ` · "${r.delete_reason}"`}</p>}
                  </td>
                  <td className="py-2 pr-3 text-slate-500">{r.phone_number || '—'}</td><td className="py-2 pr-3">{r.service_code_snapshot || r.services?.code || '—'}</td><td className="py-2 pr-3">{r.kg ?? '—'}</td><td className="py-2 pr-3">{r.no_of_loads ?? '—'}</td><td className="py-2 pr-3 font-medium">{peso(r.total_amount)}</td>
                  <td className="py-2 pr-3"><PaymentBadge method={r.payment_method} />{r.payment_method === 'gcash' && <p className="mt-1 text-[11px] text-slate-500 whitespace-nowrap">Ref: {r.gcash_reference || 'Legacy / not recorded'}</p>}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <div className="flex flex-col items-start gap-1">
                      <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${ORDER_STATUS_CLASSES[r.order_status]}`}>{ORDER_STATUS_LABELS[r.order_status]}</span>
                      {isCustomerItemsPending(r) && <span className="inline-flex rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/70 dark:text-amber-200">Items Pending</span>}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{r.pickup_date ? <>{r.pickup_date}{r.pickup_time && <span className="text-slate-400"> · {formatPickupTime(r.pickup_time)}</span>}</> : '—'}</td>
                  {isOwner && <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{r.created_by_profile?.full_name ?? '—'}{r.updated_by_profile?.full_name && r.updated_by_profile.full_name !== r.created_by_profile?.full_name && <p className="mt-0.5 text-[11px] text-slate-400">Edited by {r.updated_by_profile.full_name}</p>}</td>}
                  {hasActions && (
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                      {isDeleted ? (
                        isOwner ? <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void restore(r.id) }} disabled={restoringId === r.id} className="inline-flex items-center gap-1.5 text-emerald-600 hover:text-emerald-700 text-xs font-medium disabled:opacity-50">{restoringId === r.id && <ButtonSpinner />}{restoringId === r.id ? 'Restoring…' : '↺ Restore'}</button> : <span className="text-xs text-slate-400">Owner only</span>
                      ) : (
                        <>
                          <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); printReceipt(r) }} className="text-slate-600 hover:text-slate-800 text-xs font-medium dark:text-slate-300 dark:hover:text-slate-100">Print Receipt</button>
                          {canEdit && isCustomerItemsPending(r) && <Link to={customerItemsHref(r.id)} className="inline-flex items-center gap-1 text-amber-700 hover:text-amber-800 text-xs font-semibold dark:text-amber-300 dark:hover:text-amber-200"><UiIcon name="plus" size={14} />Add Items</Link>}
                          {canEdit && canEditTransaction(r.order_status, isDeleted) && <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openEdit(r) }} className="text-sky-600 hover:text-sky-700 text-xs font-medium">Edit</button>}
                          {canDelete && <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openDelete(r) }} className="text-red-600 hover:text-red-700 text-xs font-medium">Delete</button>}
                        </>
                      )}
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!onEdit && editingTransaction && canEdit && <EditTransactionModal transaction={editingTransaction} onClose={() => setEditingTransaction(null)} />}
      {!onDelete && deletingTransaction && canDelete && <DeleteTransactionModal transaction={deletingTransaction} onClose={() => setDeletingTransaction(null)} />}
    </>
  )
}

