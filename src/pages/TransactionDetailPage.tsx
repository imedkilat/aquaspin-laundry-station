import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ActionErrorBoundary from '../components/ActionErrorBoundary'
import CustomerItemsCard from '../components/CustomerItemsCard'
import DeleteTransactionModal from '../components/DeleteTransactionModal'
import EditTransactionModal from '../components/EditTransactionModal'
import PaymentBadge from '../components/PaymentBadge'
import TransactionStatusPanel, { StatusBadge, type TransactionStatusHistoryWithActor } from '../components/TransactionStatusPanel'
import { ButtonSpinner, EmptyState, InlineAlert, LoadingPanel } from '../components/UiFeedback'
import { useAuth } from '../lib/auth-context'
import { makeRealtimeTopic } from '../lib/realtime'
import { openTransactionReceipt } from '../lib/receipt'
import { useShopSettings } from '../lib/shop-settings-context'
import { getShopLogoUrl } from '../lib/storage-images'
import { isDropOffTransaction } from '../lib/service-classification'
import { supabase } from '../lib/supabase'
import type { TransactionCustomerItem, TransactionServiceItem, TransactionWithService } from '../types/database'

const SELECT = `*, services ( code, label ),
  created_by_profile:profiles!transactions_created_by_fkey ( full_name ),
  updated_by_profile:profiles!transactions_updated_by_fkey ( full_name ),
  deleted_by_profile:profiles!transactions_deleted_by_fkey ( full_name )`

const HISTORY_SELECT = `*, changed_by_profile:profiles!transaction_status_history_changed_by_fkey ( full_name )`

const peso = (value: number) =>
  `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const formatDateTime = (iso: string | null) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}

const formatPickupTime = (time: string | null) => {
  if (!time) return null
  const [hoursText, minutesText = '00'] = time.split(':')
  const hours = Number(hoursText)
  if (!Number.isFinite(hours)) return time
  const period = hours >= 12 ? 'PM' : 'AM'
  const displayHour = hours % 12 || 12
  return `${displayHour}:${minutesText} ${period}`
}

export default function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const { settings } = useShopSettings()
  const isOwner = profile?.role === 'owner'
  const canEdit = isOwner || settings.staff_can_edit_transactions
  const canDelete = isOwner || settings.staff_can_delete_transactions

  const [transaction, setTransaction] = useState<TransactionWithService | null>(null)
  const isTerminalOrder = ['completed', 'cancelled'].includes(transaction?.order_status ?? '')
  const [customerItems, setCustomerItems] = useState<TransactionCustomerItem[]>([])
  const [serviceItems, setServiceItems] = useState<TransactionServiceItem[]>([])
  const [history, setHistory] = useState<TransactionStatusHistoryWithActor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)

    const [transactionResult, historyResult, customerItemsResult, serviceItemsResult] = await Promise.all([
      supabase.from('transactions').select(SELECT).eq('id', id).maybeSingle(),
      supabase.from('transaction_status_history').select(HISTORY_SELECT).eq('transaction_id', id).order('changed_at', { ascending: false }),
      supabase.from('transaction_customer_items').select('*').eq('transaction_id', id).order('item_type'),
      supabase.from('transaction_service_items').select('*').eq('transaction_id', id).order('position'),
    ])

    if (transactionResult.error) {
      setError('Could not load this order. Check your connection and try again.')
      setLoading(false)
      return
    }

    setTransaction((transactionResult.data as unknown as TransactionWithService | null) ?? null)
    setCustomerItems(customerItemsResult.error ? [] : (customerItemsResult.data as unknown as TransactionCustomerItem[]) ?? [])
    setServiceItems(serviceItemsResult.error ? [] : (serviceItemsResult.data as unknown as TransactionServiceItem[]) ?? [])
    if (historyResult.error) {
      setHistory([])
      setError('The order opened, but its status history could not be loaded. Refresh and try again.')
    } else {
      setHistory((historyResult.data as unknown as TransactionStatusHistoryWithActor[]) ?? [])
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!id) return

    let hasSubscribed = false
    const channel = supabase
      .channel(makeRealtimeTopic(`transaction-detail-${id}`))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions', filter: `id=eq.${id}` },
        () => void reload()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transaction_status_history', filter: `transaction_id=eq.${id}` },
        () => void reload()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transaction_customer_items', filter: `transaction_id=eq.${id}` },
        () => void reload()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transaction_service_items', filter: `transaction_id=eq.${id}` },
        () => void reload()
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (hasSubscribed) void reload()
          hasSubscribed = true
        }
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [id, reload])

  const addOnTotal = useMemo(
    () => transaction?.add_on_items?.reduce((sum, item) => sum + Number(item.line_total || 0), 0) ?? 0,
    [transaction]
  )

  const restore = async () => {
    if (!transaction || !isOwner || !transaction.deleted_at) return
    setRestoring(true)
    setError(null)

    const { data, error: restoreError } = await supabase
      .from('transactions')
      .update({ deleted_at: null, deleted_by: null, delete_reason: null })
      .eq('id', transaction.id)
      .eq('updated_at', transaction.updated_at)
      .select('id')

    setRestoring(false)

    if (restoreError) {
      setError('Could not restore this transaction. Refresh and try again.')
      return
    }

    if (!data || data.length === 0) {
      setError('This transaction changed in another browser. Refresh it before restoring.')
      return
    }

    void reload()
  }

  if (loading && !transaction) {
    return <LoadingPanel label="Opening order details…" slowLabel="Still opening this order… your connection may be slow." />
  }

  if (!transaction) {
    return (
      <div className="space-y-4">
        <Link to="/orders" className="text-sm font-medium text-sky-600 hover:text-sky-700 dark:text-sky-400">← Back to Orders</Link>
        {error ? (
          <InlineAlert variant="error" title="Order unavailable" actionLabel="Try again" onAction={() => void reload()}>{error}</InlineAlert>
        ) : (
          <EmptyState title="Order not found" description="It may have been removed from your allowed view or the link may be invalid." />
        )}
      </div>
    )
  }

  const pickupTime = formatPickupTime(transaction.pickup_time)
  const cashChange = transaction.payment_method === 'paid'
    ? Math.max(Number(transaction.cash_amount || 0) - Number(transaction.total_amount || 0), 0)
    : 0
  const printReceipt = () => {
    try {
      openTransactionReceipt({
        transaction,
        serviceItems,
        shopName: settings.shop_display_name,
        address: settings.address,
        contactPhone: settings.contact_phone,
        logoUrl: getShopLogoUrl(settings.logo_path),
        reportFooter: settings.report_footer,
      })
    } catch (printError) {
      setError(printError instanceof Error ? printError.message : 'Could not open the receipt preview.')
    }
  }

  return (
    <>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to="/orders" className="text-sm font-medium text-sky-600 hover:text-sky-700 dark:text-sky-400">← Back to Orders</Link>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{transaction.transaction_code || `#${transaction.transaction_no}`}</h1>
              <PaymentBadge method={transaction.payment_method} />
              <StatusBadge status={transaction.order_status} />
              {transaction.deleted_at && <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">Deleted</span>}
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{transaction.customer_name} · {transaction.transaction_date}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {!transaction.deleted_at && <button type="button" onClick={printReceipt} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Print Receipt</button>}
            {!transaction.deleted_at && canEdit && !isTerminalOrder && (
              <button type="button" onClick={() => setEditing(true)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Edit</button>
            )}
            {!transaction.deleted_at && canDelete && (
              <button type="button" onClick={() => setDeleting(true)} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Delete</button>
            )}
            {transaction.deleted_at && isOwner && (
              <button type="button" onClick={() => void restore()} disabled={restoring} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
                {restoring && <ButtonSpinner />}{restoring ? 'Restoring…' : 'Restore'}
              </button>
            )}
          </div>
        </div>

        {error && <InlineAlert variant="error" title="Order action did not finish" actionLabel="Refresh" onAction={() => void reload()}>{error}</InlineAlert>}

        {transaction.deleted_at && (
          <InlineAlert variant="warning" title="This transaction is soft-deleted">
            Deleted {formatDateTime(transaction.deleted_at)} by {transaction.deleted_by_profile?.full_name || 'an authorized user'}{transaction.delete_reason ? ` · Reason: ${transaction.delete_reason}` : ''}. Only the Owner can restore it.
          </InlineAlert>
        )}

        <TransactionStatusPanel
          transaction={transaction}
          hasCustomerItems={customerItems.length > 0 && customerItems.some((item) => item.quantity > 0)}
          history={history}
          canEdit={canEdit && !transaction.deleted_at}
          isOwner={isOwner}
          onRefresh={reload}
        />

        {isDropOffTransaction(transaction) && (
          <CustomerItemsCard
            transactionId={transaction.id}
            items={customerItems}
            canEdit={canEdit && !transaction.deleted_at && !['completed', 'cancelled'].includes(transaction.order_status)}
            onSaved={reload}
          />
        )}

        <section className="grid gap-4 lg:grid-cols-3">
          <DetailCard title="Customer">
            <DetailRow label="Name" value={transaction.customer_name} />
            <DetailRow label="Phone" value={transaction.phone_number || '—'} />
            <DetailRow label="Notes" value={transaction.notes || '—'} multiline />
          </DetailCard>

          <DetailCard title={serviceItems.length > 0 ? 'Primary Service' : 'Laundry'}>
            <DetailRow label="Service" value={transaction.service_label_snapshot || transaction.service_code_snapshot || transaction.services?.label || transaction.services?.code || '—'} />
            <DetailRow label="Weight" value={transaction.kg != null ? `${transaction.kg} kg` : '—'} />
            <DetailRow label="Loads" value={transaction.no_of_loads != null ? String(transaction.no_of_loads) : '—'} />
            <DetailRow label="Base Amount" value={peso(transaction.base_amount)} />
          </DetailCard>

          <DetailCard title="Pickup">
            <DetailRow label="Pickup Date" value={transaction.pickup_date || '—'} />
            <DetailRow label="Pickup Time" value={pickupTime || '—'} />
            <DetailRow label="Recorded" value={formatDateTime(transaction.created_at)} />
          </DetailCard>
        </section>

        {serviceItems.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">Additional Services ({serviceItems.length})</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {serviceItems.map((item, index) => (
                <DetailCard key={item.id} title={`Service ${index + 2} · ${item.service_label_snapshot || item.service_code_snapshot || '—'}`}>
                  <DetailRow label="Weight" value={item.kg != null ? `${item.kg} kg` : '—'} />
                  <DetailRow label="Loads" value={item.no_of_loads != null ? String(item.no_of_loads) : '—'} />
                  <DetailRow label="Base Amount" value={peso(item.base_amount)} />
                  {item.add_on_items.length > 0 && (
                    <div className="space-y-1.5 border-t border-slate-200 pt-2 dark:border-slate-800">
                      {item.add_on_items.map((addOnItem, addOnIndex) => (
                        <div key={`${addOnItem.add_on_id}-${addOnIndex}`} className="flex items-center justify-between text-xs text-slate-500">
                          <span>{addOnItem.name} × {addOnItem.quantity}</span>
                          <span>{peso(addOnItem.line_total)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {(item.detergent_source || item.fabric_conditioner_source) && (
                    <p className="text-xs text-slate-500">Used its own detergent / fabric conditioner, tracked separately from the primary service.</p>
                  )}
                  <DetailRow label="Line Total" value={peso(item.total_amount)} strong />
                </DetailCard>
              ))}
            </div>
          </section>
        )}

        <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <DetailCard title={serviceItems.length > 0 ? 'Primary Service Add-ons' : 'Add-ons'}>
            {transaction.add_on_items?.length ? (
              <div className="space-y-2">
                {transaction.add_on_items.map((item, index) => (
                  <div key={`${item.add_on_id}-${index}`} className="flex items-start justify-between gap-4 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950">
                    <div>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{item.name}</p>
                      <p className="text-xs text-slate-500">{item.quantity} × {peso(item.unit_price)} / {item.unit_type}</p>
                    </div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{peso(item.line_total)}</p>
                  </div>
                ))}
                <div className="flex justify-between border-t border-slate-200 pt-2 text-sm dark:border-slate-800">
                  <span className="text-slate-500">Add-on total</span>
                  <span className="font-semibold">{peso(addOnTotal)}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">No add-ons on this order.</p>
            )}
          </DetailCard>

          <DetailCard title="Payment">
            <DetailRow label="Total" value={peso(transaction.total_amount)} strong />
            {serviceItems.length > 0 && (
              <p className="text-xs text-slate-500">Grand total across the primary service and {serviceItems.length} additional service{serviceItems.length === 1 ? '' : 's'}.</p>
            )}
            {transaction.payment_method === 'paid' && <>
              <DetailRow label="Cash Received" value={peso(transaction.cash_amount)} />
              <DetailRow label="Change" value={peso(cashChange)} />
            </>}
            {transaction.payment_method === 'gcash' && <>
              <DetailRow label="GCash Amount" value={peso(transaction.gcash_amount)} />
              <DetailRow label="GCash Reference" value={transaction.gcash_reference || 'Legacy / not recorded'} />
            </>}
            {transaction.payment_method === 'pay_later' && <DetailRow label="Balance Due" value={peso(transaction.total_amount)} />}
          </DetailCard>
        </section>

        {isOwner && (
          <DetailCard title="Audit">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <DetailRow label="Entered By" value={transaction.created_by_profile?.full_name || '—'} />
              <DetailRow label="Created" value={formatDateTime(transaction.created_at)} />
              <DetailRow label="Last Edited By" value={transaction.updated_by_profile?.full_name || transaction.created_by_profile?.full_name || '—'} />
              <DetailRow label="Last Updated" value={formatDateTime(transaction.updated_at)} />
            </div>
          </DetailCard>
        )}
      </div>

      {editing && !transaction.deleted_at && !isTerminalOrder && (
        <ActionErrorBoundary key={`detail-edit-${transaction.id}-${transaction.updated_at}`} onClose={() => setEditing(false)}>
          <EditTransactionModal transaction={transaction} onClose={() => { setEditing(false); void reload() }} />
        </ActionErrorBoundary>
      )}

      {deleting && (
        <ActionErrorBoundary key={`detail-delete-${transaction.id}-${transaction.updated_at}`} onClose={() => setDeleting(false)}>
          <DeleteTransactionModal transaction={transaction} onClose={() => { setDeleting(false); void reload() }} />
        </ActionErrorBoundary>
      )}
    </>
  )
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-4 font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function DetailRow({ label, value, multiline = false, strong = false }: { label: string; value: string; multiline?: boolean; strong?: boolean }) {
  return (
    <div className={multiline ? '' : 'flex items-start justify-between gap-4'}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`${multiline ? 'mt-1 whitespace-pre-wrap text-sm' : 'text-right text-sm'} ${strong ? 'text-lg font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'}`}>{value}</p>
    </div>
  )
}

