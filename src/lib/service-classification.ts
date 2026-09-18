import type { TransactionWithService } from '../types/database'

export const DROP_OFF_SERVICE_CODES = ['CSDB', 'LWB', 'PWDF', 'WDF'] as const
export const SELF_SERVICE_CODES = ['SSD', 'SSW', 'WDSS'] as const

export type ServiceIdentity = Pick<TransactionWithService, 'service_code_snapshot' | 'services'>

export function isDropOffServiceCode(code: string | null | undefined) {
  const normalized = code?.trim().toUpperCase()
  return normalized != null && DROP_OFF_SERVICE_CODES.includes(normalized as typeof DROP_OFF_SERVICE_CODES[number])
}

export function transactionServiceCode(transaction: ServiceIdentity) {
  return transaction.service_code_snapshot?.trim().toUpperCase()
    || transaction.services?.code?.trim().toUpperCase()
    || null
}

export function isDropOffTransaction(transaction: ServiceIdentity) {
  return isDropOffServiceCode(transactionServiceCode(transaction))
}
