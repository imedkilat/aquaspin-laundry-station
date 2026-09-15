import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabasePublishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY
) as string | undefined

export const supabaseConfigError =
  !supabaseUrl || !supabasePublishableKey
    ? 'Missing Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in Vercel.'
    : null

if (supabaseConfigError) {
  // eslint-disable-next-line no-console
  console.error(supabaseConfigError)
}

// Keep module initialization safe so a missing environment variable shows a
// useful in-app configuration message instead of crashing into a blank page.
export const supabase = createClient<Database>(
  supabaseUrl || 'https://invalid.supabase.co',
  supabasePublishableKey || 'invalid-key'
)

export const SHOP_NAME = (import.meta.env.VITE_SHOP_NAME as string) || 'Laundry Dashboard'
