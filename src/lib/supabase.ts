import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : (typeof process !== 'undefined' && process.env ? process.env : {})
const supabaseUrl = env.VITE_SUPABASE_URL as string | undefined
const supabasePublishableKey = (
  env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY
) as string | undefined

export const supabaseConfigError =
  !supabaseUrl || !supabasePublishableKey
    ? 'Missing Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in Vercel.'
    : null

if (supabaseConfigError && typeof console !== 'undefined' && console.error && (typeof process === 'undefined' || process.env?.NODE_ENV !== 'test')) {
  // eslint-disable-next-line no-console
  console.error(supabaseConfigError)
}

// Keep module initialization safe so a missing environment variable shows a
// useful in-app configuration message instead of crashing into a blank page.
export const supabase = createClient<Database>(
  supabaseUrl || 'https://invalid.supabase.co',
  supabasePublishableKey || 'invalid-key'
)

export const SHOP_NAME = (env.VITE_SHOP_NAME as string) || 'Laundry Dashboard'
