import type { OrderStatus } from '../types/customer-status'

export function canEditTransaction(orderStatus: OrderStatus, isDeleted: boolean) {
  return !isDeleted && orderStatus !== 'completed' && orderStatus !== 'cancelled'
}
