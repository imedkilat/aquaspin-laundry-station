import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { TransactionWithService } from '../types/database'

interface Options {
  // Optional date filter (YYYY-MM-DD). When omitted, loads the most recent 200 rows.
  dateFrom?: string
  dateTo?: string
  limit?: number
}

const SELECT = '*, services ( code, label )'

export function useTransactions(options: Options = {}) {
  const { dateFrom, dateTo, limit = 200 } = options
  const [rows, setRows] = useState<TransactionWithService[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    setLoading(true)
    let query = supabase
      .from('transactions')
      .select(SELECT)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (dateFrom) query = query.gte('transaction_date', dateFrom)
    if (dateTo) query = query.lte('transaction_date', dateTo)

    query.then(({ data, error }) => {
      if (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to load transactions', error)
      }
      setRows((data as unknown as TransactionWithService[]) ?? [])
      setLoading(false)
    })
  }, [dateFrom, dateTo, limit])

  useEffect(() => {
    reload()
  }, [reload])

  // Live updates: any staff/owner adding, editing, or deleting a transaction
  // reflects here immediately, across every open dashboard/tablet.
  useEffect(() => {
    const channel = supabase
      .channel('transactions-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions' },
        () => reload()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [reload])

  return { rows, loading, reload }
}
