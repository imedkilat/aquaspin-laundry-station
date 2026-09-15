import type { TransactionWithService } from '../types/database'
import PaymentBadge from './PaymentBadge'

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function TransactionTable({
  rows,
  loading,
}: {
  rows: TransactionWithService[]
  loading: boolean
}) {
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
          <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
            <th className="py-2 pr-3 font-medium">No.</th>
            <th className="py-2 pr-3 font-medium">Date</th>
            <th className="py-2 pr-3 font-medium">Customer</th>
            <th className="py-2 pr-3 font-medium">Phone</th>
            <th className="py-2 pr-3 font-medium">Service</th>
            <th className="py-2 pr-3 font-medium">Kg</th>
            <th className="py-2 pr-3 font-medium">Loads</th>
            <th className="py-2 pr-3 font-medium">Total</th>
            <th className="py-2 pr-3 font-medium">Payment</th>
            <th className="py-2 pr-3 font-medium">Pickup</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
              <td className="py-2 pr-3 text-slate-500">#{String(r.transaction_no).padStart(4, '0')}</td>
              <td className="py-2 pr-3">{r.transaction_date}</td>
              <td className="py-2 pr-3 font-medium text-slate-900">{r.customer_name}</td>
              <td className="py-2 pr-3 text-slate-500">{r.phone_number || '—'}</td>
              <td className="py-2 pr-3">{r.services?.code || '—'}</td>
              <td className="py-2 pr-3">{r.kg ?? '—'}</td>
              <td className="py-2 pr-3">{r.no_of_loads ?? '—'}</td>
              <td className="py-2 pr-3 font-medium">{peso(r.total_amount)}</td>
              <td className="py-2 pr-3">
                <PaymentBadge method={r.payment_method} />
              </td>
              <td className="py-2 pr-3 text-slate-500">{r.pickup_date || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
