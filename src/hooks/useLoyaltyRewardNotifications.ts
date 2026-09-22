import { useCallback, useEffect, useState } from 'react'
import { makeRealtimeTopic } from '../lib/realtime'
import { supabase } from '../lib/supabase'
import type { RealtimeState } from './useServices'

export type LoyaltyRewardHomeNotification = {
  id: string
  customer_id: string
  customer_name: string
  customer_code: string
  created_at: string
  // Current live balance, so an Owner/Staff who hasn't redeemed yet sees an
  // up-to-date number even if the customer has earned more points since
  // qualifying. Threshold and reward description are the values recorded at
  // qualification time (they rarely change, and reading them straight off
  // the notification avoids granting Staff any additional table access).
  current_points_balance: number
  points_required_for_reward: number
  reward_description: string
}

type NotificationRow = {
  id: string
  customer_id: string
  created_at: string
  points_required_for_reward: number
  reward_description: string
}
type CustomerRow = { id: string; full_name: string; customer_code: string }
type BalanceRow = { customer_id: string; points_balance: number }

export function useLoyaltyRewardNotifications() {
  const [rows, setRows] = useState<LoyaltyRewardHomeNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [realtimeState, setRealtimeState] = useState<RealtimeState>('connecting')

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: notificationError } = await supabase
      .from('loyalty_reward_notifications')
      .select('id, customer_id, created_at, points_required_for_reward, reward_description')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(100)

    if (notificationError) {
      setRows([])
      setError('Could not load loyalty reward notifications.')
      setLoading(false)
      return
    }

    const notifications = (data ?? []) as unknown as NotificationRow[]
    if (notifications.length === 0) {
      setRows([])
      setLoading(false)
      return
    }

    const customerIds = [...new Set(notifications.map((row) => row.customer_id))]

    const [{ data: customers, error: customerError }, { data: balances, error: balanceError }] = await Promise.all([
      supabase.from('customers').select('id, full_name, customer_code').in('id', customerIds),
      supabase.from('customer_loyalty_balance').select('customer_id, points_balance').in('customer_id', customerIds),
    ])

    if (customerError || balanceError) {
      setRows([])
      setError('Loyalty reward notifications loaded, but customer details could not be loaded.')
      setLoading(false)
      return
    }

    const customerById = new Map((((customers ?? []) as unknown as CustomerRow[])).map((row) => [row.id, row]))
    const balanceById = new Map((((balances ?? []) as unknown as BalanceRow[])).map((row) => [row.customer_id, row]))

    setRows(
      notifications.map((row) => {
        const customer = customerById.get(row.customer_id)
        const balance = balanceById.get(row.customer_id)
        return {
          id: row.id,
          customer_id: row.customer_id,
          customer_name: customer?.full_name ?? 'Unknown customer',
          customer_code: customer?.customer_code ?? '',
          created_at: row.created_at,
          current_points_balance: Number(balance?.points_balance ?? row.points_required_for_reward),
          points_required_for_reward: row.points_required_for_reward,
          reward_description: row.reward_description,
        }
      }),
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    setRealtimeState('connecting')
    let hasSubscribed = false
    const channel = supabase
      .channel(makeRealtimeTopic('home-loyalty-reward-notifications'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loyalty_reward_notifications' }, () => void reload())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeState('connected')
          if (hasSubscribed) void reload()
          hasSubscribed = true
        } else if (status === 'CHANNEL_ERROR') setRealtimeState('error')
        else if (status === 'TIMED_OUT' || status === 'CLOSED') setRealtimeState('disconnected')
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [reload])

  return { rows, loading, error, realtimeState, reload }
}
