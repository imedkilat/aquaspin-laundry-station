import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase, SHOP_NAME } from './supabase'
import { useAuth } from './auth-context'
import { makeRealtimeTopic } from './realtime'
import type { ShopSettings } from '../types/database'

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  id: 1,
  shop_display_name: SHOP_NAME || 'Aquaspin Laundry Station',
  contact_phone: null,
  address: null,
  report_footer: null,
  logo_path: null,
  default_payment_method: 'pay_later',
  default_dashboard_days: 7,
  require_phone_number: false,
  require_pickup_date: false,
  require_notes_for_pay_later: false,
  allow_manual_total_override: true,
  staff_can_create_transactions: true,
  staff_can_access_dashboard: true,
  staff_can_view_full_history: true,
  staff_can_edit_transactions: true,
  staff_can_delete_transactions: true,
  staff_can_view_historical_pay_later: true,
  staff_can_edit_own_profile: true,
  staff_can_manage_customers: true,
  updated_at: new Date(0).toISOString(),
  updated_by: null,
}

type SettingsState = {
  settings: ShopSettings
  loading: boolean
  error: string | null
  realtimeState: 'idle' | 'connected' | 'disconnected' | 'error'
  reload: () => Promise<void>
}

const ShopSettingsContext = createContext<SettingsState | undefined>(undefined)

export function ShopSettingsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [settings, setSettings] = useState<ShopSettings>(DEFAULT_SHOP_SETTINGS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [realtimeState, setRealtimeState] = useState<SettingsState['realtimeState']>('idle')

  const reload = useCallback(async () => {
    if (!session) {
      setSettings(DEFAULT_SHOP_SETTINGS)
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error: queryError } = await supabase
      .from('shop_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle()

    if (queryError) {
      // Safe rollout fallback: if the settings migration has not landed yet,
      // the existing Aquaspin app keeps working with conservative defaults.
      setError(queryError.message)
      setLoading(false)
      return
    }

    setSettings({ ...DEFAULT_SHOP_SETTINGS, ...(data ?? {}) })
    setError(null)
    setLoading(false)
  }, [session])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!session) {
      setRealtimeState('idle')
      return
    }

    let hasSubscribed = false
    const channel = supabase
      .channel(makeRealtimeTopic('shop-settings-realtime'))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shop_settings' },
        () => void reload()
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeState('connected')
          if (hasSubscribed) void reload()
          hasSubscribed = true
        }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRealtimeState('error')
        else if (status === 'CLOSED') setRealtimeState('disconnected')
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [reload, session])

  return (
    <ShopSettingsContext.Provider value={{ settings, loading, error, realtimeState, reload }}>
      {children}
    </ShopSettingsContext.Provider>
  )
}

export function useShopSettings() {
  const value = useContext(ShopSettingsContext)
  if (!value) throw new Error('useShopSettings must be used within ShopSettingsProvider')
  return value
}

