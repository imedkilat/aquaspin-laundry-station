import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

if (!supabaseUrl || !supabasePublishableKey) {
  // eslint-disable-next-line no-console
  console.error(
    'Missing Supabase env vars. Copy .env.example to .env and fill in your project URL/anon key.'
  )
}

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey)

export const SHOP_NAME = (import.meta.env.VITE_SHOP_NAME as string) || 'Laundry Dashboard'
