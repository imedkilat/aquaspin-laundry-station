import { FunctionsHttpError } from '@supabase/supabase-js'

// supabase-js throws a generic "Edge Function returned a non-2xx status
// code" for every 4xx/5xx response from an Edge Function and buries the
// function's own `{ error: "..." }` JSON body inside `error.context` (the
// raw Response object) instead of surfacing it. Every caller of
// `functions.invoke()` needs the real message -- "Too many exports in a
// short time..." instead of "Edge Function returned a non-2xx status
// code" -- so this is shared rather than repeated per call site.
export async function edgeFunctionErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json()
      if (body && typeof body.error === 'string' && body.error.trim()) {
        return body.error
      }
    } catch {
      // Response body wasn't JSON (or was already consumed) -- fall through
      // to the generic message below instead of throwing.
    }
  }

  if (error instanceof Error && error.message) return error.message
  return fallback
}
