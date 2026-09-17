import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_LOYALTY_SETTINGS } from '../lib/loyalty-settings'
import { supabase } from '../lib/supabase'
import { ButtonSpinner, EmptyState, InlineAlert, LoadingPanel } from './UiFeedback'
import type { CustomerLoyaltyBalance, LoyaltyPointEvent, LoyaltyRedemption, LoyaltySettings } from '../types/database'

const points = (value: number) => Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })

export default function LoyaltyManager() {
  const [customers, setCustomers] = useState<CustomerLoyaltyBalance[]>([])
  const [events, setEvents] = useState<LoyaltyPointEvent[]>([])
  const [redemptions, setRedemptions] = useState<LoyaltyRedemption[]>([])
  const [settings, setSettings] = useState<LoyaltySettings>(DEFAULT_LOYALTY_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [redeemingCustomerId, setRedeemingCustomerId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [customerResult, eventResult, redemptionResult, settingsResult] = await Promise.all([
      supabase.from('customer_loyalty_balance').select('*').order('active', { ascending: false }).order('full_name'),
      supabase.from('loyalty_point_events').select('*').order('created_at', { ascending: false }),
      supabase.from('loyalty_redemptions').select('*').order('redeemed_at', { ascending: false }),
      supabase.from('loyalty_settings').select('*').eq('id', 1).maybeSingle(),
    ])

    const firstError = customerResult.error || eventResult.error || redemptionResult.error || settingsResult.error
    if (firstError) {
      setError(firstError.message)
    } else {
      setCustomers((customerResult.data as CustomerLoyaltyBalance[]) ?? [])
      setEvents((eventResult.data as LoyaltyPointEvent[]) ?? [])
      setRedemptions((redemptionResult.data as LoyaltyRedemption[]) ?? [])
      setSettings({ ...DEFAULT_LOYALTY_SETTINGS, ...((settingsResult.data as LoyaltySettings | null) ?? {}) })
    }
    setLoading(false)
  }, [])

  useEffect(() => { void reload() }, [reload])

  const redeem = async (customer: CustomerLoyaltyBalance) => {
    if (Number(customer.points_balance) < Number(settings.points_required_for_reward)) return
    if (!window.confirm(`Redeem ${settings.reward_description} for ${customer.full_name}? This will spend ${points(settings.points_required_for_reward)} points.`)) return

    setRedeemingCustomerId(customer.customer_id)
    setMessage(null)
    const { error: redeemError } = await supabase.rpc('redeem_loyalty_reward', { p_customer_id: customer.customer_id, p_notes: null })
    setRedeemingCustomerId(null)
    if (redeemError) {
      setError(redeemError.message)
      return
    }
    setMessage(`${settings.reward_description} redeemed for ${customer.full_name}.`)
    await reload()
  }

  const ledgerByCustomer = useMemo(() => {
    const result = new Map<string, Array<{ kind: 'earned' | 'redeemed'; date: string; detail: string }>>()
    for (const event of events) {
      const ledger = result.get(event.customer_id) ?? []
      ledger.push({ kind: 'earned', date: event.created_at, detail: `+${points(event.points_earned)} points · ${points(event.kg)} kg · transaction ${event.transaction_id.slice(0, 8)}` })
      result.set(event.customer_id, ledger)
    }
    for (const redemption of redemptions) {
      const ledger = result.get(redemption.customer_id) ?? []
      ledger.push({ kind: 'redeemed', date: redemption.redeemed_at, detail: `−${points(redemption.points_spent)} points · ${redemption.reward_description}` })
      result.set(redemption.customer_id, ledger)
    }
    for (const ledger of result.values()) ledger.sort((a, b) => b.date.localeCompare(a.date))
    return result
  }, [events, redemptions])

  if (loading) return <LoadingPanel label="Loading loyalty balances…" slowLabel="Still loading loyalty records…" />

  return (
    <div className="space-y-5">
      {error && <InlineAlert variant="error" title="Loyalty data could not be refreshed" actionLabel="Try again" onAction={() => void reload()}>{error}</InlineAlert>}
      {message && <InlineAlert variant="success" title="Reward redeemed">{message}</InlineAlert>}

      <section className="rounded-2xl border border-sky-200 bg-sky-50 p-5 dark:border-sky-900/60 dark:bg-sky-950/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">Phase 7</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">Loyalty / Rewards</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Customers earn {points(settings.points_per_kg)} point{Number(settings.points_per_kg) === 1 ? '' : 's'} per kg processed. At {points(settings.points_required_for_reward)} points, redeem one: {settings.reward_description}.</p>
          </div>
          <button type="button" onClick={() => void reload()} className="rounded-lg border border-sky-300 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-white dark:border-sky-800 dark:text-sky-300 dark:hover:bg-slate-900">↻ Refresh</button>
        </div>
      </section>

      {customers.length === 0 ? <EmptyState title="No customers yet" description="Loyalty balances will appear when canonical customers are added." /> : (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {customers.map((customer) => {
              const balance = Number(customer.points_balance || 0)
              const required = Number(settings.points_required_for_reward)
              const ledger = ledgerByCustomer.get(customer.customer_id) ?? []
              const canRedeem = balance >= required
              return (
                <div key={customer.customer_id} className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900 dark:text-slate-100">{customer.full_name}</h3><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{customer.customer_code}</span>{!customer.active && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">Inactive</span>}</div>
                      <p className="mt-1 text-sm text-slate-500">{points(balance)} points · {canRedeem ? 'Reward available' : `${points(Math.max(required - balance, 0))} more needed`}</p>
                    </div>
                    <button type="button" disabled={!canRedeem || redeemingCustomerId !== null} onClick={() => void redeem(customer)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
                      {redeemingCustomerId === customer.customer_id && <ButtonSpinner />}Redeem Reward
                    </button>
                  </div>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-sky-700 dark:text-sky-300">View auditable ledger ({ledger.length} entr{ledger.length === 1 ? 'y' : 'ies'})</summary>
                    {ledger.length === 0 ? <p className="mt-2 text-xs text-slate-500">No points or redemptions yet.</p> : <div className="mt-2 space-y-1.5 rounded-xl bg-slate-50 p-3 dark:bg-slate-950">{ledger.map((entry, index) => <div key={`${entry.date}-${index}`} className="flex flex-wrap justify-between gap-2 text-xs"><span className={entry.kind === 'earned' ? 'text-emerald-700 dark:text-emerald-300' : 'text-violet-700 dark:text-violet-300'}>{entry.detail}</span><time className="text-slate-500" dateTime={entry.date}>{new Date(entry.date).toLocaleString('en-PH')}</time></div>)}</div>}
                  </details>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

