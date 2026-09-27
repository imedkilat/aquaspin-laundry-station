import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import UiIcon from '../components/UiIcon'
import { ButtonSpinner } from '../components/UiFeedback'
import type { OrderStatus } from '../types/customer-status'

type PublicOrderStatusData = {
  found: boolean
  error?: string
  transaction_code: string
  order_status: OrderStatus
  service_name: string
  kg: number | null
  no_of_loads: number | null
  total_amount: number
  payment_method: string
  is_paid: boolean
  transaction_date: string
  pickup_date: string | null
  pickup_time: string | null
  created_at: string
  updated_at: string
  shop_name: string
  shop_phone: string | null
  shop_address: string | null
}

const peso = (val: number) =>
  `₱${Number(val || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const STEPS: Array<{ key: OrderStatus; label: string; icon: string; desc: string }> = [
  { key: 'received', label: 'Received', icon: '📥', desc: 'Weighed & checked in' },
  { key: 'washing', label: 'Washing', icon: '🫧', desc: 'In the wash cycle' },
  { key: 'drying', label: 'Drying', icon: '💨', desc: 'Tumble drying & fluffing' },
  { key: 'ready_for_pickup', label: 'Ready for Pickup', icon: '✨', desc: 'Clean, folded & packed' },
  { key: 'completed', label: 'Completed', icon: '🎉', desc: 'Claimed & delivered' },
]

export default function PublicOrderTrackerPage() {
  const { code } = useParams<{ code: string }>()
  const [data, setData] = useState<PublicOrderStatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchStatus = async (quiet = false) => {
    if (!code) {
      setError('Please provide a tracking code.')
      setLoading(false)
      return
    }

    if (quiet) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const { data: rawResult, error: rpcError } = await supabase.rpc('get_public_order_status', {
        p_code: code.trim(),
      })

      if (rpcError) {
        setError(rpcError.message || 'Could not look up your order status.')
        return
      }

      const result = (rawResult as unknown) as PublicOrderStatusData | null
      if (!result || !result.found) {
        setError(result?.error || 'Order not found. Please double-check your claim code.')
        setData(null)
        return
      }

      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error. Please try again.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void fetchStatus()
  }, [code])

  if (loading) {
    return (
      <div className="min-h-svh flex items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-lg dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-300">
            <ButtonSpinner />
          </div>
          <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-slate-100">Checking Laundry Status…</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Looking up tracking code: {code}</p>
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
          <h2 className="mt-4 text-lg font-bold text-slate-900 dark:text-slate-100">Order Not Found</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {error || `We couldn't locate any laundry record with code "${code}".`}
          </p>
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

  const currentStatusIndex = STEPS.findIndex((s) => s.key === data.order_status)
  const isSpecialStatus = data.order_status === 'on_hold' || data.order_status === 'cancelled'

  return (
    <div className="min-h-svh bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Top Shop Banner */}
      <header className="border-b border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-600 text-white font-black text-lg shadow-sm">
              <UiIcon name="wash" size={22} />
            </span>
            <div>
              <h1 className="text-sm font-bold leading-tight sm:text-base">{data.shop_name}</h1>
              {data.shop_address && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">{data.shop_address}</p>
              )}
            </div>
          </div>
          {data.shop_phone && (
            <a
              href={`tel:${data.shop_phone}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300"
            >
              📞 Call Shop
            </a>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto max-w-lg p-4 sm:p-6 space-y-5">
        {/* Status Highlight Card */}
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
              <p className="text-xs text-slate-500 dark:text-slate-400">Dropped off on {data.transaction_date}</p>
            </div>
            {data.order_status === 'ready_for_pickup' && (
              <span className="animate-pulse rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                READY FOR PICKUP
              </span>
            )}
          </div>

          {/* Stepper Display */}
          {!isSpecialStatus ? (
            <div className="mt-6 space-y-6">
              <div className="relative pl-6 space-y-6 border-l-2 border-slate-200 dark:border-slate-800">
                {STEPS.map((step, index) => {
                  const isDone = currentStatusIndex > index
                  const isCurrent = currentStatusIndex === index
                  const isUpcoming = currentStatusIndex < index

                  return (
                    <div key={step.key} className="relative group">
                      {/* Node Bullet */}
                      <span
                        className={`absolute -left-[31px] top-0 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition ${
                          isDone
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : isCurrent
                            ? 'bg-sky-600 text-white ring-4 ring-sky-100 dark:ring-sky-950/60 shadow-xs'
                            : 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {isDone ? '✓' : index + 1}
                      </span>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-base">{step.icon}</span>
                          <span
                            className={`text-sm font-bold ${
                              isCurrent
                                ? 'text-sky-600 dark:text-sky-400'
                                : isDone
                                ? 'text-slate-900 dark:text-slate-100'
                                : 'text-slate-400 dark:text-slate-500'
                            }`}
                          >
                            {step.label}
                          </span>
                          {isCurrent && (
                            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                              Current stage
                            </span>
                          )}
                        </div>
                        <p className={`mt-0.5 text-xs ${isUpcoming ? 'text-slate-400 dark:text-slate-600' : 'text-slate-500 dark:text-slate-400'}`}>
                          {step.desc}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className={`mt-5 rounded-xl p-4 text-center ${data.order_status === 'on_hold' ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' : 'bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300'}`}>
              <div className="text-lg font-bold">
                {data.order_status === 'on_hold' ? '⚠️ Order is Temporarily On Hold' : '❌ Order Cancelled'}
              </div>
              <p className="mt-1 text-xs">
                {data.order_status === 'on_hold'
                  ? 'Our staff placed this order on hold (e.g. awaiting confirmation or special care). Please call the shop for details.'
                  : 'This order was cancelled. Please contact the front desk.'}
              </p>
            </div>
          )}
        </section>

        {/* Order Details & Bill Summary */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Order Summary</h2>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
              <span className="text-slate-500 dark:text-slate-400">Service</span>
              <div className="mt-1 font-bold text-slate-900 dark:text-slate-100">{data.service_name}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
              <span className="text-slate-500 dark:text-slate-400">Weight &amp; Loads</span>
              <div className="mt-1 font-bold text-slate-900 dark:text-slate-100">
                {data.kg ? `${data.kg} kg` : '—'} ({data.no_of_loads ?? 1} load{Number(data.no_of_loads || 1) > 1 ? 's' : ''})
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-slate-600 dark:text-slate-300">Total Bill</span>
              <span className="text-lg font-black text-slate-900 dark:text-slate-100">{peso(data.total_amount)}</span>
            </div>

            <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-500">Payment Status</span>
              {data.is_paid ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  ✓ Paid ({data.payment_method === 'paid' ? 'Cash' : 'GCash'})
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  Pay Later · Balance Due on Pickup
                </span>
              )}
            </div>
          </div>

          {data.pickup_date && (
            <div className="flex items-center gap-2 rounded-xl bg-sky-50 px-4 py-3 text-xs text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
              <span>📅</span>
              <span><strong>Estimated Ready Date:</strong> {data.pickup_date}{data.pickup_time ? ` @ ${data.pickup_time}` : ''}</span>
            </div>
          )}
        </section>

        {/* Footer Note */}
        <p className="text-center text-xs text-slate-400 dark:text-slate-500">
          Present your claim code <span className="font-bold text-slate-600 dark:text-slate-300">{data.transaction_code}</span> when picking up your laundry.
        </p>
      </main>
    </div>
  )
}
