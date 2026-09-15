import { useMemo } from 'react'
import TransactionForm from '../components/TransactionForm'
import TransactionTable from '../components/TransactionTable'
import { useTransactions } from '../hooks/useTransactions'
import { shopDate } from '../lib/date'

export default function StaffView() {
  const todayStr = useMemo(() => shopDate(), [])
  const { rows, loading, reload } = useTransactions({ dateFrom: todayStr, dateTo: todayStr })

  return (
    <div className="space-y-6">
      <TransactionForm onAdded={reload} />

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-900">Today's Transactions</h2>
          <span className="text-xs text-slate-400">{rows.length} entries · updates live</span>
        </div>
        <TransactionTable rows={rows} loading={loading} />
      </div>
    </div>
  )
}
