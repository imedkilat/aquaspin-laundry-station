import { useState } from 'react'
import { Link } from 'react-router-dom'
import TransactionForm from '../components/TransactionForm'
import { InlineAlert } from '../components/UiFeedback'

export default function NewOrderPage() {
  const [saved, setSaved] = useState(false)

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600 dark:text-sky-400">Laundry intake</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">New Order</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Record the customer, weight, service, add-ons, payment, and pickup details.</p>
        </div>
        <Link to="/orders" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          View Orders
        </Link>
      </section>

      {saved && (
        <InlineAlert variant="success" title="Order saved">
          The transaction is now in Aquaspin. You can add another order or open Orders to review it.
        </InlineAlert>
      )}

      <TransactionForm onAdded={() => setSaved(true)} />
    </div>
  )
}
