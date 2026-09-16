import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { makeRealtimeTopic } from '../lib/realtime'
import type { TransactionWithService } from '../types/database'
import type { RealtimeState } from './useServices'

interface Options {
  dateFrom?: string
  dateTo?: string
  limit?: number
  includeDeleted?: boolean
}

const SELECT = `*, services ( code, label ),
  created_by_profile:profiles!transactions_created_by_fkey ( full_name ),
  updated_by_profile:profiles!transactions_updated_by_fkey ( full_name ),
  deleted_by_profile:profiles!transactions_deleted_by_fkey ( full_name )`

export function useTransactions(options: Options = {}) {
  const { dateFrom, dateTo, limit = 200, includeDeleted = false } = options
  const [rows, setRows] = useState<TransactionWithService[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [realtimeState, setRealtimeState] = useState<RealtimeState>('connecting')

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)

    let query = supabase
      .from('transactions')
      .select(SELECT)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (dateFrom) query = query.gte('transaction_date', dateFrom)
    if (dateTo) query = query.lte('transaction_date', dateTo)
    if (!includeDeleted) query = query.is('deleted_at', null)

    const { data, error: queryError } = await query
    if (queryError) {
      setError('Could not load transactions. Check the internet connection and try again.')
      setLoading(false)
      return
    }

    setRows((data as unknown as TransactionWithService[]) ?? [])
    setLoading(false)
  }, [dateFrom, dateTo, limit, includeDeleted])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    setRealtimeState('connecting')
    const channel = supabase
      .channel(makeRealtimeTopic('transactions-realtime'))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions' },
        () => void reload()
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRealtimeState('connected')
        else if (status === 'CHANNEL_ERROR') setRealtimeState('error')
        else if (status === 'TIMED_OUT' || status === 'CLOSED') setRealtimeState('disconnected')
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [reload])

  return { rows, loading, error, realtimeState, reload }
}
