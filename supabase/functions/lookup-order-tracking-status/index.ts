import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createTrackingRateLimitKey, lookupPublicTrackingStatus } from '../../../src/lib/public-tracking.ts'

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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const secret = Deno.env.get('TRACKING_TOKEN_SECRET_HEX')
  if (!supabaseUrl || !serviceRoleKey || !secret) {
    return json(503, { error: 'Tracking is temporarily unavailable.' })
  }

  try {
    // Supabase's gateway provides the client address in X-Forwarded-For.
    // Store only an HMAC of it in rate_limit_hits, never the raw address.
    const forwardedFor = request.headers.get('x-forwarded-for')
    const clientAddress = forwardedFor?.split(',')[0]?.trim()
    const rateLimitKey = clientAddress ? await createTrackingRateLimitKey(clientAddress, secret) : null
    if (!rateLimitKey) return json(503, { found: false, error: 'Tracking is temporarily unavailable.' })

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: withinLimit, error: rateLimitError } = await admin.rpc('check_rate_limit', {
      p_key: rateLimitKey,
      p_max_count: 60,
      p_window_seconds: 60,
    })
    if (rateLimitError) return json(503, { found: false, error: 'Tracking is temporarily unavailable.' })
    if (!withinLimit) return json(429, { found: false, error: 'Too many tracking checks. Try again shortly.' })

    const payload: unknown = await request.json()
    const token = typeof payload === 'object' && payload !== null && 'token' in payload
      ? (payload as { token?: unknown }).token
      : null
    if (typeof token !== 'string') return json(404, { found: false, error: 'Order not found.' })

    // The privileged client is used only after validating the signed capability.
    // Its selected columns and response are deliberately restricted to the public allowlist.
    const result = await lookupPublicTrackingStatus(token, secret, async (transactionId) => {
      const { data: row, error } = await admin
        .from('transactions')
        .select('transaction_code, order_status, deleted_at')
        .eq('id', transactionId)
        .maybeSingle()
      if (error) throw error
      return row
    })
    return result.found
      ? json(200, result)
      : json(404, { found: false, error: 'Order not found.' })
  } catch {
    return json(503, { error: 'Tracking is temporarily unavailable.' })
  }
})
