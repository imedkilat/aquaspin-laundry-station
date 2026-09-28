import { useCallback, useEffect, useState } from 'react'
import { makeRealtimeTopic } from '../lib/realtime'
import { supabase } from '../lib/supabase'
import type { CustomerLoyaltyBalance, TransactionWithService } from '../types/database'
import type { Customer, CustomerSummary } from '../types/customer-status'

export type CustomerListRow = Customer & CustomerSummary & {
  points_balance: number | null
  first_visit: string | null
  has_redeemed_reward: boolean | null
}

const TRANSACTION_SELECT = `*, services ( code, label )`

export function useCustomers({ includeRedemptions = false }: { includeRedemptions?: boolean } = {}) {
  const [rows, setRows] = useState<CustomerListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [customerDirectoryError, setCustomerDirectoryError] = useState<string | null>(null)
  const [realtimeState, setRealtimeState] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting')
  const [directoryDataWarning, setDirectoryDataWarning] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    setCustomerDirectoryError(null)

    const [customersResult, summaryResult, loyaltyResult, historyResult, redemptionResult] = await Promise.all([
      supabase.from('customers').select('*').order('active', { ascending: false }).order('full_name'),
      supabase.from('customer_summary').select('*'),
      supabase.from('customer_loyalty_balance').select('*'),
      supabase.from('customer_transaction_history').select('customer_id, transaction_date').is('deleted_at', null).order('transaction_date', { ascending: true }),
      includeRedemptions
        ? supabase.from('loyalty_redemptions').select('customer_id')
        : Promise.resolve({ data: null, error: null }),
    ])

    const firstVisitByCustomer = new Map<string, string>()
    for (const transaction of (historyResult.data ?? []) as Array<{ customer_id: string; transaction_date: string }>) {
      if (!firstVisitByCustomer.has(transaction.customer_id)) firstVisitByCustomer.set(transaction.customer_id, transaction.transaction_date)
    }
    const redeemedCustomerIds = new Set(((redemptionResult.data ?? []) as Array<{ customer_id: string }>).map((row) => row.customer_id))
    setDirectoryDataWarning([
      historyResult.error ? 'First-visit dates could not be loaded; Newest uses registration date for those customers.' : '',
      includeRedemptions && redemptionResult.error ? 'Reward redemption data is unavailable right now.' : '',
    ].filter(Boolean).join(' ') || null)

    if (customersResult.error) {
      const message = 'Could not load customers. Check the connection and try again.'
      setError(message)
      setCustomerDirectoryError(message)
      setLoading(false)
      return
    }
    if (summaryResult.error) {
      setError('Customers loaded, but their summaries could not be refreshed. Try again.')
      setRows(((customersResult.data as Customer[]) ?? []).map((customer) => ({
        ...customer,
        customer_id: customer.id,
        customer_code: customer.customer_code,
        total_transactions: 0,
        total_billed: 0,
        total_collected: 0,
        outstanding_balance: 0,
        last_visit: null,
        points_balance: null,
        first_visit: firstVisitByCustomer.get(customer.id) ?? null,
        has_redeemed_reward: includeRedemptions && !redemptionResult.error ? redeemedCustomerIds.has(customer.id) : null,
      })))
      setLoading(false)
      return
    }

    const summaries = new Map((summaryResult.data as CustomerSummary[]).map((summary) => [summary.customer_id, summary]))
    const loyaltyBalances = new Map(((loyaltyResult.data as CustomerLoyaltyBalance[] | null) ?? []).map((balance) => [balance.customer_id, balance.points_balance]))
    setRows(((customersResult.data as Customer[]) ?? []).map((customer) => ({
      ...customer,
      ...(summaries.get(customer.id) ?? {
        customer_id: customer.id,
        customer_code: customer.customer_code,
        total_transactions: 0,
        total_billed: 0,
        total_collected: 0,
        outstanding_balance: 0,
        last_visit: null,
      }),
      points_balance: loyaltyResult.error ? null : (loyaltyBalances.get(customer.id) ?? 0),
      first_visit: firstVisitByCustomer.get(customer.id) ?? null,
      has_redeemed_reward: includeRedemptions && !redemptionResult.error ? redeemedCustomerIds.has(customer.id) : null,
    })))
    setLoading(false)
  }, [includeRedemptions])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    setRealtimeState('connecting')
    let hasSubscribed = false
    const channel = supabase
      .channel(makeRealtimeTopic('customers-realtime'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => void reload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => void reload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loyalty_redemptions' }, () => void reload())
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

  return { rows, loading, error, customerDirectoryError, realtimeState, directoryDataWarning, reload }
}

export function useCustomerDetail(id: string | undefined) {
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [summary, setSummary] = useState<CustomerSummary | null>(null)
  const [loyaltyBalance, setLoyaltyBalance] = useState<CustomerLoyaltyBalance | null>(null)
  const [transactions, setTransactions] = useState<TransactionWithService[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)

    const [customerResult, summaryResult, transactionsResult, loyaltyResult] = await Promise.all([
      supabase.from('customers').select('*').eq('id', id).maybeSingle(),
      supabase.from('customer_summary').select('*').eq('customer_id', id).maybeSingle(),
      supabase.from('customer_transaction_history').select(TRANSACTION_SELECT).eq('customer_id', id).order('transaction_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('customer_loyalty_balance').select('*').eq('customer_id', id).maybeSingle(),
    ])

    if (customerResult.error || transactionsResult.error) {
      setError('Could not load this customer. Check the connection and try again.')
      setLoading(false)
      return
    }
    setCustomer((customerResult.data as Customer | null) ?? null)
    setSummary((summaryResult.data as CustomerSummary | null) ?? null)
    setLoyaltyBalance(loyaltyResult.error ? null : ((loyaltyResult.data as CustomerLoyaltyBalance | null) ?? null))
    setTransactions((transactionsResult.data as unknown as TransactionWithService[]) ?? [])
    if (summaryResult.error) setError('Customer loaded, but the financial summary could not be refreshed.')
    setLoading(false)
  }, [id])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!id) return
    let hasSubscribed = false
    const channel = supabase
      .channel(makeRealtimeTopic(`customer-detail-${id}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers', filter: `id=eq.${id}` }, () => void reload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `customer_id=eq.${id}` }, () => void reload())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (hasSubscribed) void reload()
          hasSubscribed = true
        }
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [id, reload])

  return { customer, summary, loyaltyBalance, transactions, loading, error, reload }
}

