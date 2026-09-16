export type OrderStatus = 'received' | 'washing' | 'drying' | 'ready_for_pickup' | 'completed' | 'on_hold' | 'cancelled'

export type Customer = {
  id: string
  customer_code: string
  full_name: string
  phone_number: string | null
  normalized_phone: string | null
  notes: string | null
  active: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type TransactionStatusHistory = {
  id: string
  transaction_id: string
  previous_status: OrderStatus | null
  new_status: OrderStatus
  changed_at: string
  changed_by: string | null
  reason: string | null
}

// Totals cover only active transactions visible to the caller under RLS.
export type CustomerSummary = {
  customer_id: string
  customer_code: string
  total_transactions: number
  total_billed: number
  total_collected: number
  outstanding_balance: number
  last_visit: string | null
}
