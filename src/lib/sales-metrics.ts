import type { PaymentMethod } from '../types/database'
import type { OrderStatus } from '../types/customer-status'

export type SalesMetricRow = {
  id?: string
  transaction_date: string
  payment_method: PaymentMethod
  total_amount: number | null
  cash_amount: number | null
  gcash_amount: number | null
  order_status: OrderStatus
  deleted_at: string | null
  kg?: number | null
}

export type SalesMetrics = {
  monthlySales: number
  cashCollected: number
  outstandingPayLater: number
  todaySales: number
  todayOrders: number
  todayWeight: number
}

const finiteNonNegative = (value: number | null | undefined) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0
}

export function isValidSalesMetricRow(row: SalesMetricRow, shopDate: string) {
  const total = Number(row.total_amount)
  return row.deleted_at == null
    && row.order_status !== 'cancelled'
    && row.transaction_date <= shopDate
    && Number.isFinite(total)
    && total >= 0
}

export function outstandingPayLaterBalance(row: SalesMetricRow) {
  const total = finiteNonNegative(row.total_amount)
  const collected = Math.min(total, finiteNonNegative(row.cash_amount) + finiteNonNegative(row.gcash_amount))
  return Math.max(total - collected, 0)
}

export function calculateSalesMetrics(rows: SalesMetricRow[], shopDate: string, monthStart: string): SalesMetrics {
  const uniqueRows = rows.filter((row, index) => !row.id || rows.findIndex((candidate) => candidate.id === row.id) === index)
  const validRows = uniqueRows.filter((row) => isValidSalesMetricRow(row, shopDate))
  const monthRows = validRows.filter((row) => row.transaction_date >= monthStart)
  const todayRows = validRows.filter((row) => row.transaction_date === shopDate)

  return {
    monthlySales: monthRows.reduce((sum, row) => sum + Number(row.total_amount), 0),
    cashCollected: monthRows
      .filter((row) => row.payment_method === 'paid' || row.payment_method === 'gcash')
      .reduce((sum, row) => sum + Number(row.total_amount), 0),
    outstandingPayLater: validRows
      .filter((row) => row.payment_method === 'pay_later')
      .reduce((sum, row) => sum + outstandingPayLaterBalance(row), 0),
    todaySales: todayRows.reduce((sum, row) => sum + Number(row.total_amount), 0),
    todayOrders: todayRows.length,
    todayWeight: todayRows.reduce((sum, row) => sum + finiteNonNegative(row.kg), 0),
  }
}
