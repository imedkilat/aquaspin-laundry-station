import { useCallback, useEffect, useState } from 'react'
import { makeRealtimeTopic } from '../lib/realtime'
import { supabase } from '../lib/supabase'
import type { TransactionWithService } from '../types/database'
import type { Customer, CustomerSummary } from '../types/customer-status'

export type CustomerListRow = Customer & CustomerSummary

const TRANSACTION_SELECT = `*, services ( code, label )`

export function useCustomers() {
  const [rows, setRows] = useState<CustomerListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [realtimeState, setRealtimeState] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting')

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [customersResult, summaryResult] = await Promise.all([
      supabase.from('customers').select('*').order('active', { ascending: false }).order('full_name'),
      supabase.from('customer_summary').select('*'),
    ])

    if (customersResult.error) {
      setError('Could not load customers. Check the connection and try again.')
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
      })))
      setLoading(false)
      return
    }

    const summaries = new Map((summaryResult.data as CustomerSummary[]).map((summary) => [summary.customer_id, summary]))
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
    })))
    setLoading(false)
  }, [])

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

export function useCustomerDetail(id: string | undefined) {
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [summary, setSummary] = useState<CustomerSummary | null>(null)
  const [transactions, setTransactions] = useState<TransactionWithService[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)

    const [customerResult, summaryResult, transactionsResult] = await Promise.all([
      supabase.from('customers').select('*').eq('id', id).maybeSingle(),
      supabase.from('customer_summary').select('*').eq('customer_id', id).maybeSingle(),
      supabase.from('customer_transaction_history').select(TRANSACTION_SELECT).eq('customer_id', id).order('transaction_date', { ascending: false }).order('created_at', { ascending: false }),
    ])

    if (customerResult.error || transactionsResult.error) {
      setError('Could not load this customer. Check the connection and try again.')
      setLoading(false)
      return
    }
    setCustomer((customerResult.data as Customer | null) ?? null)
    setSummary((summaryResult.data as CustomerSummary | null) ?? null)
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

  return { customer, summary, transactions, loading, error, reload }
}
