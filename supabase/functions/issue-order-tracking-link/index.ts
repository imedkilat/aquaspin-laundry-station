import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { canIssuePublicTrackingLink, createPublicTrackingToken } from '../../../src/lib/public-tracking.ts'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' })

  const authorization = request.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const secret = Deno.env.get('TRACKING_TOKEN_SECRET_HEX')
  if (!authorization?.startsWith('Bearer ') || !supabaseUrl || !anonKey || !secret) {
    return json(401, { error: 'Sign in to create a tracking link.' })
  }

  try {
    const client = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    })

    const { data: authData, error: authError } = await client.auth.getUser()
    if (authError || !authData.user) return json(401, { error: 'Sign in to create a tracking link.' })

    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('role, is_active')
      .eq('id', authData.user.id)
      .maybeSingle()
    if (profileError || !canIssuePublicTrackingLink(profile)) {
      return json(403, { error: 'You do not have access to create a tracking link.' })
    }

    const payload: unknown = await request.json()
    const transactionId = typeof payload === 'object' && payload !== null && 'transactionId' in payload
      ? (payload as { transactionId?: unknown }).transactionId
      : null
    if (typeof transactionId !== 'string' || transactionId.length > 64) {
      return json(400, { error: 'Invalid transaction.' })
    }

    // Read through the authenticated client so the existing transaction RLS policy remains in force.
    const { data: transaction, error: transactionError } = await client
      .from('transactions')
      .select('id, order_status, deleted_at')
      .eq('id', transactionId)
      .maybeSingle()
    if (transactionError) return json(503, { error: 'Could not create the tracking link. Please try again.' })
    if (!transaction || transaction.deleted_at || transaction.order_status === 'cancelled') {
      return json(404, { error: 'Tracking is unavailable for this order.' })
    }

    const token = await createPublicTrackingToken(transaction.id, secret)
    if (!token) return json(503, { error: 'Tracking is temporarily unavailable.' })

    // Keep the bearer capability in the fragment: browsers do not send fragments
    // in HTTP requests or Referer headers.
    return json(200, { path: `/track#${token}` })
  } catch {
    return json(400, { error: 'Could not create the tracking link.' })
  }
})
