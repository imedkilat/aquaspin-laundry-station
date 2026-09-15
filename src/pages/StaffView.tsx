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

      <div className="bg-white rounded-2xl border border-slate-200 p-5 dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">Today's Transactions</h2>
            <span className="text-xs text-slate-400">{rows.length} entries · updates live</span>
          </div>
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
        <TransactionTable rows={rows} loading={loading} />
      </div>
    </div>
  )
}
