import type { PaymentMethod } from '../types/database'

const STYLES: Record<PaymentMethod, string> = {
  paid: 'bg-emerald-100 text-emerald-700',
  gcash: 'bg-sky-100 text-sky-700',
  pay_later: 'bg-amber-100 text-amber-700',
}

const LABELS: Record<PaymentMethod, string> = {
  paid: 'Paid',
  gcash: 'GCash',
  pay_later: 'Pay Later',
}

export default function PaymentBadge({ method }: { method: PaymentMethod }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STYLES[method]}`}>
      {LABELS[method]}
    </span>
  )
}
