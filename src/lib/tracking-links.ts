import { supabase } from './supabase'

export async function requestOrderTrackingPath(transactionId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('issue-order-tracking-link', {
    body: { transactionId },
  })

  if (error || typeof data?.path !== 'string' || !data.path.startsWith('/track#v1.')) {
    throw new Error('Could not create a secure tracking link for this order.')
  }

  return data.path
}
