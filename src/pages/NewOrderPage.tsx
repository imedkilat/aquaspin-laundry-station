import { useState } from 'react'
import { Link } from 'react-router-dom'
import TransactionForm from '../components/TransactionForm'
import BentoCard from '../components/BentoCard'
import UiIcon from '../components/UiIcon'
import { InlineAlert } from '../components/UiFeedback'

export default function NewOrderPage() {
  const [saved, setSaved] = useState(false)

  return (
    <div className="space-y-5">
      <BentoCard title="New order" description="Record the customer, weight, service, inventory usage, add-ons, payment, and pickup details." icon="plus" tone="sky" action={<Link to="/orders" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><UiIcon name="orders" size={16} />View orders</Link>}>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600 dark:text-sky-400">Laundry intake · ready for today’s queue</p>
      </BentoCard>

      {saved && (
        <InlineAlert variant="success" title="Order saved">
          The transaction is now in Aquaspin. You can add another order or open Orders to review it.
        </InlineAlert>
      )}

      <TransactionForm onAdded={() => setSaved(true)} />
    </div>
  )
}
