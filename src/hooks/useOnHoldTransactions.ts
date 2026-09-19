import { useCallback, useEffect, useState } from 'react'
import { makeRealtimeTopic } from '../lib/realtime'
import { supabase } from '../lib/supabase'
import type { RealtimeState } from './useServices'

export type OnHoldTransaction = {
  id: string
  transaction_no: number
  transaction_code: string
  customer_name: string
  transaction_date: string
  order_status: 'on_hold'
  updated_at: string
  reason: string | null
  reason_changed_at: string | null
}

type OnHoldTransactionRow = Pick<OnHoldTransaction, 'id' | 'transaction_no' | 'transaction_code' | 'customer_name' | 'transaction_date' | 'order_status' | 'updated_at'>
type OnHoldHistoryRow = { transaction_id: string; new_status: string; reason: string | null; changed_at: string }

export function useOnHoldTransactions() {
  const [rows, setRows] = useState<OnHoldTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [realtimeState, setRealtimeState] = useState<RealtimeState>('connecting')

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: transactionError } = await supabase
      .from('transactions')
      .select('id, transaction_no, transaction_code, customer_name, transaction_date, order_status, updated_at')
      .eq('order_status', 'on_hold')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(100)

    if (transactionError) {
      setRows([])
      setError('Could not load On Hold notifications.')
      setLoading(false)
      return
    }

    const transactions = (data ?? []) as unknown as OnHoldTransactionRow[]
    if (transactions.length === 0) {
      setRows([])
      setLoading(false)
      return
    }

    const { data: history, error: historyError } = await supabase
      .from('transaction_status_history')
      .select('transaction_id, new_status, reason, changed_at')
      .in('transaction_id', transactions.map((row) => row.id))
      .eq('new_status', 'on_hold')
      .order('changed_at', { ascending: false })

    if (historyError) {
      setRows([])
      setError('On Hold orders loaded, but their reasons could not be loaded.')
      setLoading(false)
      return
    }

    const latestReasons = new Map<string, OnHoldHistoryRow>()
    for (const row of ((history ?? []) as unknown as OnHoldHistoryRow[])) {
      if (!latestReasons.has(row.transaction_id)) latestReasons.set(row.transaction_id, row)
    }

    setRows(transactions.map((row) => {
      const historyRow = latestReasons.get(row.id)
      return {
        ...row,
        order_status: 'on_hold',
        reason: historyRow?.reason ?? null,
        reason_changed_at: historyRow?.changed_at ?? null,
      }
    }))
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    setRealtimeState('connecting')
    let hasSubscribed = false
    const channel = supabase
      .channel(makeRealtimeTopic('home-on-hold-notifications'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => void reload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transaction_status_history' }, () => void reload())
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
