import { useEffect, useState } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import UiIcon from '../components/UiIcon'
import { ButtonSpinner } from '../components/UiFeedback'
import type { OrderStatus } from '../types/customer-status'

type PublicOrderStatusData = {
  found: boolean
  transaction_code: string
  order_status: OrderStatus
}

const STEPS: Array<{ key: OrderStatus; label: string; icon: string; desc: string }> = [
  { key: 'received', label: 'Received', icon: '📥', desc: 'Weighed & checked in' },
  { key: 'washing', label: 'Washing', icon: '🫧', desc: 'In the wash cycle' },
  { key: 'drying', label: 'Drying', icon: '💨', desc: 'Tumble drying & fluffing' },
  { key: 'ready_for_pickup', label: 'Ready for Pickup', icon: '✨', desc: 'Clean, folded & packed' },
  { key: 'completed', label: 'Completed', icon: '🎉', desc: 'Claimed & delivered' },
]

export default function PublicOrderTrackerPage() {
  const { hash } = useLocation()
  const token = hash.startsWith('#v1.') ? hash.slice(1) : ''
  const [data, setData] = useState<PublicOrderStatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchStatus = async (quiet = false) => {
    if (!token) {
      setError('This tracking link is invalid or unavailable.')
      setLoading(false)
      return
    }

    if (quiet) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const { data: result, error: lookupError } = await supabase.functions.invoke('lookup-order-tracking-status', {
        body: { token },
      })

      if (lookupError || !result?.found) {
        setData(null)
        setError('This tracking link is invalid or unavailable.')
        return
      }
      setData(result as PublicOrderStatusData)
    } catch {
      setData(null)
      setError('Could not check this order right now. Please try again.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void fetchStatus()
    // The route token identifies the capability being looked up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  if (loading) {
    return (
      <div className="min-h-svh flex items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-lg dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-300">
            <ButtonSpinner />
          </div>
          <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-slate-100">Checking Laundry Status…</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Your tracking link is being checked securely.</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-svh flex items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-300">
            <UiIcon name="alert" size={28} />
          </div>
          <h2 className="mt-4 text-lg font-bold text-slate-900 dark:text-slate-100">Tracking Unavailable</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{error}</p>
          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void fetchStatus()}
              className="rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-sky-500"
            >
              Try Again
            </button>
            <Link
              to="/login"
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300"
            >
              Staff / Owner Sign In
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const currentStatusIndex = STEPS.findIndex((step) => step.key === data.order_status)
  const isOnHold = data.order_status === 'on_hold'

  return (
    <div className="min-h-svh bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-4 sm:px-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-600 text-white font-black text-lg shadow-sm">
            <UiIcon name="wash" size={22} />
          </span>
          <h1 className="text-sm font-bold leading-tight sm:text-base">Aquaspin Laundry Station</h1>
        </div>
      </header>

      <main className="mx-auto max-w-lg p-4 sm:p-6 space-y-5">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">Live Laundry Tracker</span>
            <button
              type="button"
              onClick={() => void fetchStatus(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 disabled:opacity-60"
            >
              <UiIcon name="refresh" size={14} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Updating…' : 'Refresh'}
            </button>
          </div>

          <div className="mt-3 flex items-baseline justify-between gap-2 border-b border-slate-100 pb-4 dark:border-slate-800">
            <div>
              <div className="text-2xl font-black tracking-tight">{data.transaction_code}</div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Order progress</p>
            </div>
            {data.order_status === 'ready_for_pickup' && (
              <span className="animate-pulse rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                READY FOR PICKUP
              </span>
            )}
          </div>

          {!isOnHold ? (
            <div className="mt-6 space-y-6">
              <div className="relative pl-6 space-y-6 border-l-2 border-slate-200 dark:border-slate-800">
                {STEPS.map((step, index) => {
                  const isDone = currentStatusIndex > index
                  const isCurrent = currentStatusIndex === index
                  const isUpcoming = currentStatusIndex < index
                  return (
                    <div key={step.key} className="relative group">
                      <span className={`absolute -left-[31px] top-0 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition ${isDone ? 'bg-emerald-600 text-white shadow-xs' : isCurrent ? 'bg-sky-600 text-white ring-4 ring-sky-100 dark:ring-sky-950/60 shadow-xs' : 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                        {isDone ? '✓' : index + 1}
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-base">{step.icon}</span>
                          <span className={`text-sm font-bold ${isCurrent ? 'text-sky-600 dark:text-sky-400' : isDone ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`}>
                            {step.label}
                          </span>
                          {isCurrent && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-700 dark:bg-sky-950 dark:text-sky-300">Current stage</span>}
                        </div>
                        <p className={`mt-0.5 text-xs ${isUpcoming ? 'text-slate-400 dark:text-slate-600' : 'text-slate-500 dark:text-slate-400'}`}>{step.desc}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-xl bg-amber-50 p-4 text-center text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
              <div className="text-lg font-bold">⚠️ Order is Temporarily On Hold</div>
              <p className="mt-1 text-xs">Please contact the shop for details.</p>
            </div>
          )}
        </section>

        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          Present your claim code <span className="font-bold text-slate-700 dark:text-slate-200">{data.transaction_code}</span> when picking up your laundry.
        </p>
      </main>
    </div>
  )
}
