import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Transaction } from '../../src/types/database'
import type { Customer, CustomerSummary } from '../../src/types/customer-status'

declare const client: SupabaseClient<Database>

// Compile-only contracts: no runtime client or network request.
async function contracts() {
  const created = await client.from('customers').insert({ full_name: 'Example', phone_number: '09171234567' }).select().single()
  const customer: Customer | null = created.data
  const summary = await client.from('customer_summary').select().eq('customer_id', 'example').single()
  const totals: CustomerSummary | null = summary.data
  const billed: number | undefined = totals?.total_billed
  const collected: number | undefined = totals?.total_collected
  const outstanding: number | undefined = totals?.outstanding_balance
  const changed = await client.rpc('set_transaction_status', {
    p_transaction_id: 'example', p_status: 'washing', p_expected_updated_at: '2026-01-01T00:00:00.000001Z',
  })
  const transaction: Transaction | null = changed.data
  const deleted = await client.rpc('soft_delete_transaction', {
    p_transaction_id: 'example', p_expected_updated_at: '2026-01-01T00:00:00.000001Z', p_delete_reason: 'Duplicate',
  })
  const deleteResult = deleted.data?.[0]
  const deleteSuccess: boolean | undefined = deleteResult?.success
  // @ts-expect-error Raw status writes are deliberately absent from update types.
  client.from('transactions').update({ order_status: 'completed' })
  // @ts-expect-error Ledger writes are deliberately absent from insert types.
  client.from('transaction_status_history').insert({ transaction_id: 'example', new_status: 'completed' })
  return { customer, totals, billed, collected, outstanding, transaction, deleteSuccess }
}

export type BackendContract = ReturnType<typeof contracts>
