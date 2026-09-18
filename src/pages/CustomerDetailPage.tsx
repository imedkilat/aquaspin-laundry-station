import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import CustomerForm from '../components/CustomerForm'
import PaymentBadge from '../components/PaymentBadge'
import { StatusBadge } from '../components/TransactionStatusPanel'
import { EmptyState, InlineAlert, LoadingPanel } from '../components/UiFeedback'
import { useCustomerDetail } from '../hooks/useCustomers'
import { useAuth } from '../lib/auth-context'
import { useShopSettings } from '../lib/shop-settings-context'

const peso = (value: number) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { settings } = useShopSettings()
  const isOwner = profile?.role === 'owner'
  const canManage = isOwner || settings.staff_can_manage_customers
  const { customer, summary, loyaltyBalance, transactions, loading, error, reload } = useCustomerDetail(id)
  const [editing, setEditing] = useState(false)

  if (loading && !customer) return <LoadingPanel label="Opening customer…" slowLabel="Still loading this customer…" />
  if (!customer) return <div className="space-y-4"><Link to="/customers" className="text-sm font-medium text-sky-600">← Back to Customers</Link><EmptyState title="Customer not found" description={error || 'This customer is not in your allowed view.'} /></div>

 return <div className="space-y-5"><Link to="/customers" className="text-sm font-medium text-sky-600 dark:text-sky-400">← Back to Customers</Link><section className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600 dark:text-sky-400">Customer profile</p><div className="mt-1 flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{customer.full_name}</h1><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{customer.customer_code}</span>{!customer.active && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">Inactive</span>}</div><p className="mt-1 text-sm text-slate-500">{customer.phone_number || 'No phone recorded'}</p></div>{canManage && <button type="button" onClick={() => setEditing(true)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Edit customer</button>}</section>{editing && <CustomerForm customer={customer} isOwner={isOwner} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); void reload() }} onDeleted={() => navigate('/customers')} />}{error && <InlineAlert variant="warning" title="Some customer data could not be refreshed" actionLabel="Refresh" onAction={() => void reload()}>{error}</InlineAlert>}<section className="grid grid-cols-2 gap-3 lg:grid-cols-6"><Summary label="Visits" value={String(summary?.total_transactions ?? 0)} /><Summary label="Billed" value={peso(Number(summary?.total_billed))} /><Summary label="Collected" value={peso(Number(summary?.total_collected))} /><Summary label="Outstanding" value={peso(Number(summary?.outstanding_balance))} warning={Number(summary?.outstanding_balance) > 0} /><Summary label="Last visit" value={summary?.last_visit || '—'} /><Summary label="Loyalty points" value={loyaltyBalance ? Number(loyaltyBalance.points_balance).toLocaleString('en-PH', { maximumFractionDigits: 2 }) : '—'} /></section><section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><h2 className="font-semibold text-slate-900 dark:text-slate-100">Customer notes</h2><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{customer.notes || 'No notes recorded.'}</p></section><section className="space-y-3"><div><h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Transaction history</h2><p className="text-sm text-slate-500">Historical transaction name and phone snapshots remain unchanged.</p></div>{transactions.length === 0 ? <EmptyState title="No linked transactions yet" description="Use the Existing Customer picker in New Order to link future transactions." /> : <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="divide-y divide-slate-200 dark:divide-slate-800">{transactions.map((transaction) => <Link key={transaction.id} to={`/orders/${transaction.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50"><div><p className="font-medium text-slate-900 dark:text-slate-100">{transaction.transaction_code}</p><p className="mt-1 text-xs text-slate-500">{transaction.transaction_date} · {transaction.customer_name}</p></div><div className="flex items-center gap-2"><StatusBadge status={transaction.order_status} /><PaymentBadge method={transaction.payment_method} /><span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{peso(Number(transaction.total_amount))}</span></div></Link>)}</div></div>}</section></div>
}

function Summary({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) { return <div className={`rounded-2xl border p-4 ${warning ? 'border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{value}</p></div> }

