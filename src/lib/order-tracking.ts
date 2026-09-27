import { supabase } from './supabase.ts'
import { edgeFunctionErrorMessage } from './edge-functions.ts'

export interface IssueOrderTrackingLinkOptions {
  origin?: string
  supabaseClient?: {
    functions: {
      invoke: (
        functionName: string,
        options: { body: Record<string, unknown> }
      ) => Promise<{ data: unknown; error: unknown }>
    }
  }
}

/**
 * Issues an authenticated, signed order tracking capability link.
 * Calls the `issue-order-tracking-link` Supabase Edge Function with the transaction UUID.
 *
 * Invariant: The capability token is placed exclusively in the URL fragment (`/track#v1...`),
 * never in the HTTP path, query string, or client logs.
 */
export async function issueOrderTrackingLink(
  transactionId: string,
  options: IssueOrderTrackingLinkOptions = {}
): Promise<string> {
  const trimmedId = (transactionId || '').trim()
  if (!trimmedId) {
    throw new Error('Transaction ID is required to issue tracking link')
  }

  const client = (options.supabaseClient ?? supabase) as {
    functions: {
      invoke: (
        functionName: string,
        options: { body: Record<string, unknown> }
      ) => Promise<{ data: unknown; error: unknown }>
    }
  }

  const { data, error: functionError } = await client.functions.invoke('issue-order-tracking-link', {
    body: { transaction_id: trimmedId },
  })

  if (functionError) {
    const message = await edgeFunctionErrorMessage(functionError, 'Failed to issue secure tracking link.')
    throw new Error(message)
  }

  const responseData = data as { path?: unknown } | null
  const path = responseData?.path
  if (typeof path !== 'string' || !path.startsWith('/track#v1.')) {
    throw new Error('Server returned an invalid tracking link format.')
  }

  const origin =
    options.origin ??
    (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '')

  return `${origin}${path}`
}
