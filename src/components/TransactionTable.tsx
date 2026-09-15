import type { TransactionWithService } from '../types/database'
import PaymentBadge from './PaymentBadge'

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
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
            >
              <td className="py-2 pr-3 font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
                {r.transaction_code || `#${String(r.transaction_no).padStart(4, '0')}`}
              </td>
              <td className="py-2 pr-3">{r.transaction_date}</td>
              <td className="py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">{r.customer_name}</td>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
