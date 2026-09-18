import type { OrderStatus } from '../types/customer-status'
import type { Role, TransactionWithService } from '../types/database'
import { isDropOffTransaction } from './service-classification.ts'

export const PENDING_CUSTOMER_ITEM_STATUSES: readonly OrderStatus[] = [
  'received',
  'washing',
  'drying',
  'ready_for_pickup',
  'on_hold',
]

export const CUSTOMER_ITEM_STATUS_LABELS: Record<OrderStatus, string> = {
  received: 'Received',
  washing: 'Washing',
  drying: 'Drying',
  ready_for_pickup: 'Ready for Pickup',
  completed: 'Completed',
  on_hold: 'On Hold',
  cancelled: 'Cancelled',
}

export type CustomerItemCoverageRow = Pick<TransactionWithService, 'deleted_at' | 'order_status' | 'service_code_snapshot' | 'services'> & {
  hasCustomerItems?: boolean
}

export function hasPositiveCustomerItems(items: Array<{ quantity: number | null | undefined }>) {
  return items.some((item) => Number(item.quantity) > 0)
}

export function isCustomerItemsPending(row: CustomerItemCoverageRow) {
  return row.deleted_at == null
    && PENDING_CUSTOMER_ITEM_STATUSES.includes(row.order_status)
    && isDropOffTransaction(row)
    && row.hasCustomerItems === false
}

export function canEditCustomerItems(role: Role | null | undefined, staffCanEditTransactions: boolean) {
  return role === 'owner' || staffCanEditTransactions
}

export function customerItemsHref(transactionId: string) {
  return `/orders/${transactionId}#customer-items`
}
