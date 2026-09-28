export type CustomerDirectorySort = 'newest' | 'most_visits' | 'redeemed' | 'name'
export type CustomerActivityFilter = 'active' | 'all' | 'inactive'

export type CustomerDirectoryEntry = {
  id: string
  full_name: string
  customer_code: string
  phone_number: string | null
  active: boolean
  created_at: string
  first_visit: string | null
  total_transactions: number
  last_visit: string | null
  outstanding_balance: number
  points_balance: number | null
  has_redeemed_reward: boolean | null
}

export type CustomerDirectoryOptions = {
  search?: string
  activity?: CustomerActivityFilter
  sort?: CustomerDirectorySort
}

const compareNames = (a: CustomerDirectoryEntry, b: CustomerDirectoryEntry) =>
  a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)

function dateValue(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

export function getCustomerDirectoryRows<T extends CustomerDirectoryEntry>(
  rows: readonly T[],
  { search = '', activity = 'active', sort = 'name' }: CustomerDirectoryOptions = {},
): T[] {
  const needle = search.trim().toLocaleLowerCase()
  const filtered = rows.filter((row) => {
    if (activity === 'active' && !row.active) return false
    if (activity === 'inactive' && row.active) return false
    if (sort === 'redeemed' && row.has_redeemed_reward !== true) return false
    if (!needle) return true
    return [row.full_name, row.phone_number ?? '', row.customer_code]
      .some((value) => value.toLocaleLowerCase().includes(needle))
  })

  return filtered.sort((a, b) => {
    if (sort === 'newest') {
      return dateValue(b.first_visit ?? b.created_at) - dateValue(a.first_visit ?? a.created_at) || compareNames(a, b)
    }
    if (sort === 'most_visits') {
      return Number(b.total_transactions || 0) - Number(a.total_transactions || 0) || compareNames(a, b)
    }
    return compareNames(a, b)
  })
}

export function paginateCustomerRows<T>(rows: readonly T[], requestedPage: number, pageSize = 20) {
  const safePageSize = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 20
  const pageCount = Math.max(1, Math.ceil(rows.length / safePageSize))
  const page = Math.min(pageCount, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1))
  const start = (page - 1) * safePageSize
  return {
    rows: rows.slice(start, start + safePageSize),
    page,
    pageCount,
    total: rows.length,
  }
}
