import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { makeRealtimeTopic } from '../lib/realtime'
import type { PaymentMethod, TransactionWithService } from '../types/database'
import type { OrderStatus } from '../types/customer-status'
import type { RealtimeState } from './useServices'

interface Options {
  dateFrom?: string
  dateTo?: string
  limit?: number
  includeDeleted?: boolean
  fetchAll?: boolean
  paymentMethod?: PaymentMethod
  orderStatuses?: readonly OrderStatus[]
  includeCustomerItemCoverage?: boolean
  // Attach each row's additional-service-lines kg total (serviceItemsKg) via
  // a batch fetch, the same way includeCustomerItemCoverage attaches
  // hasCustomerItems. Opt-in so pages that don't need it (most of them)
  // don't pay for an extra query.
  includeServiceItemsWeight?: boolean
}

const SELECT = `*, services ( code, label ),
  created_by_profile:profiles!transactions_created_by_fkey ( full_name ),
  updated_by_profile:profiles!transactions_updated_by_fkey ( full_name ),
  deleted_by_profile:profiles!transactions_deleted_by_fkey ( full_name )`

export function useTransactions(options: Options = {}) {
  const {
    dateFrom,
    dateTo,
    limit = 200,
    includeDeleted = false,
    fetchAll = false,
    paymentMethod,
    orderStatuses,
    includeCustomerItemCoverage = false,
    includeServiceItemsWeight = false,
  } = options
  const [rows, setRows] = useState<TransactionWithService[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [realtimeState, setRealtimeState] = useState<RealtimeState>('connecting')

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)

    const pageSize = Math.max(1, Math.min(limit, 1000))

    const fetchPage = async (offset: number) => {
      let query = fetchAll
        ? supabase.from('transactions').select(SELECT, { count: 'exact' })
        : supabase.from('transactions').select(SELECT)

      query = query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })

      if (dateFrom) query = query.gte('transaction_date', dateFrom)
      if (dateTo) query = query.lte('transaction_date', dateTo)
      if (paymentMethod) query = query.eq('payment_method', paymentMethod)
      if (orderStatuses?.length) query = query.in('order_status', [...orderStatuses])
      if (!includeDeleted) query = query.is('deleted_at', null)

      return fetchAll
        ? query.range(offset, offset + pageSize - 1)
        : query.limit(limit)
    }

    const attachCustomerItemCoverage = async (nextRows: TransactionWithService[]) => {
      if (!includeCustomerItemCoverage || nextRows.length === 0) return nextRows

      const transactionIds = nextRows.map((row) => row.id)
      const { data, error: coverageError } = await supabase
        .from('transaction_customer_items')
        .select('transaction_id, quantity')
        .in('transaction_id', transactionIds)

      if (coverageError) throw coverageError

      const coveredIds = new Set(
        ((data ?? []) as Array<{ transaction_id: string; quantity: number | null }>)
          .filter((item) => Number(item.quantity) > 0)
          .map((item) => item.transaction_id),
      )

      return nextRows.map((row) => ({ ...row, hasCustomerItems: coveredIds.has(row.id) }))
    }

    const attachServiceItemsWeight = async (nextRows: TransactionWithService[]) => {
      if (!includeServiceItemsWeight || nextRows.length === 0) return nextRows

      const transactionIds = nextRows.map((row) => row.id)
      const { data, error: weightError } = await supabase
        .from('transaction_service_items')
        .select('transaction_id, kg')
        .in('transaction_id', transactionIds)

      if (weightError) throw weightError

      const kgByTransaction = new Map<string, number>()
      for (const item of (data ?? []) as Array<{ transaction_id: string; kg: number | null }>) {
        if (item.kg == null) continue
        kgByTransaction.set(item.transaction_id, (kgByTransaction.get(item.transaction_id) ?? 0) + Number(item.kg))
      }

      return nextRows.map((row) => ({ ...row, serviceItemsKg: kgByTransaction.get(row.id) ?? 0 }))
    }

    const finish = async (nextRows: TransactionWithService[], coverageMessage: string) => {
      try {
        setRows(await attachServiceItemsWeight(await attachCustomerItemCoverage(nextRows)))
      } catch {
        setRows(nextRows)
        setError(coverageMessage)
      }
      setLoading(false)
    }

    if (!fetchAll) {
      const { data, error: queryError } = await fetchPage(0)
      if (queryError) {
        setError('Could not load transactions. Check the internet connection and try again.')
        setLoading(false)
        return
      }

      await finish((data as unknown as TransactionWithService[]) ?? [], 'Could not load customer item coverage. Check the internet connection and try again.')
      return
    }

    const allRows: TransactionWithService[] = []
    let offset = 0

    while (true) {
      const { data, error: queryError, count } = await fetchPage(offset)
      if (queryError) {
        setError('Could not load the complete transaction range. Check the internet connection and try again.')
        setLoading(false)
        return
      }

      const page = (data as unknown as TransactionWithService[]) ?? []
      allRows.push(...page)

      if (page.length === 0) break
      offset += page.length

      if (typeof count === 'number' && allRows.length >= count) break
      if (count == null && page.length < pageSize) break
    }

    await finish(allRows, 'Could not load customer item coverage. Check the internet connection and try again.')
  }, [dateFrom, dateTo, limit, includeDeleted, fetchAll, paymentMethod, orderStatuses, includeCustomerItemCoverage, includeServiceItemsWeight])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    setRealtimeState('connecting')
    let hasSubscribed = false
    const channel = supabase
      .channel(makeRealtimeTopic('transactions-realtime'))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions' },
        () => void reload()
      )
    if (includeCustomerItemCoverage) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transaction_customer_items' },
        () => void reload(),
      )
    }
    if (includeServiceItemsWeight) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transaction_service_items' },
        () => void reload(),
      )
    }

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setRealtimeState('connected')
        if (hasSubscribed) void reload()
        hasSubscribed = true
      }
      else if (status === 'CHANNEL_ERROR') setRealtimeState('error')
      else if (status === 'TIMED_OUT' || status === 'CLOSED') setRealtimeState('disconnected')
    })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [reload, includeCustomerItemCoverage, includeServiceItemsWeight])

  return { rows, loading, error, realtimeState, reload }
}
