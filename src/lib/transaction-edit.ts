import type { OrderStatus } from '../types/customer-status'

export function canEditTransaction(orderStatus: OrderStatus, isDeleted: boolean, isOwner = false) {
  return !isDeleted && orderStatus !== 'cancelled' && (orderStatus !== 'completed' || isOwner)
}
