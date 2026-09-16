import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { makeRealtimeTopic } from '../lib/realtime'
import type { TransactionWithService } from '../types/database'

interface Options {
  // Optional date filter (YYYY-MM-DD). When omitted, loads the most recent 200 rows.
  dateFrom?: string
  dateTo?: string
  limit?: number
  // Soft-deleted rows are excluded by default. Pass true (Owner Dashboard's
  // "Show deleted" toggle) to include them alongside active rows.
  includeDeleted?: boolean
}

// Three separate FKs from transactions to profiles (created_by, updated_by,
// deleted_by) need explicit relationship hints so PostgREST knows which is
// which. Non-owners only ever see their own profile row here (RLS), so
// these resolve to null for anyone else's transactions -- fine, since the
// UI only shows this to owners.
const SELECT = `*, services ( code, label ),
  created_by_profile:profiles!transactions_created_by_fkey ( full_name ),
  updated_by_profile:profiles!transactions_updated_by_fkey ( full_name ),
  deleted_by_profile:profiles!transactions_deleted_by_fkey ( full_name )`

export function useTransactions(options: Options = {}) {
  const { dateFrom, dateTo, limit = 200, includeDeleted = false } = options
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
    if (!includeDeleted) query = query.is('deleted_at', null)

    query.then(({ data, error }) => {
      if (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to load transactions', error)
      }
      setRows((data as unknown as TransactionWithService[]) ?? [])
      setLoading(false)
    })
  }, [dateFrom, dateTo, limit, includeDeleted])

  useEffect(() => {
    reload()
  }, [reload])

  // Live updates: any staff/owner adding, editing, or deleting a transaction
  // reflects here immediately, across every open dashboard/tablet. Each
  // mounted subscription gets its own topic so multiple tables/modals and
  // React StrictMode cannot collide inside one browser instance.
  useEffect(() => {
    const channel = supabase
      .channel(makeRealtimeTopic('transactions-realtime'))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions' },
        () => reload()
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [reload])

  return { rows, loading, reload }
}
