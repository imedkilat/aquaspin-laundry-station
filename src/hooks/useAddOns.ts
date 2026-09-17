import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { makeRealtimeTopic } from '../lib/realtime'
import type { AddOn } from '../types/database'
import type { RealtimeState } from './useServices'

export function useAddOns(options: { includeInactive?: boolean } = {}) {
  const { includeInactive = false } = options
  const [addOns, setAddOns] = useState<AddOn[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [realtimeState, setRealtimeState] = useState<RealtimeState>('connecting')

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)

    let query = supabase.from('add_ons_catalog').select('*').order('name')
    if (!includeInactive) query = query.eq('active', true)

    const { data, error: queryError } = await query
    if (queryError) {
      setError('Could not load add-ons. Check the connection and try again.')
      setLoading(false)
      return
    }

    setAddOns(data ?? [])
    setLoading(false)
  }, [includeInactive])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    setRealtimeState('connecting')
    let hasSubscribed = false
    const channel = supabase
      .channel(makeRealtimeTopic(`add-ons-realtime-${includeInactive ? 'all' : 'active'}`))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'add_ons_catalog' },
        () => void reload()
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeState('connected')
          if (hasSubscribed) void reload()
          hasSubscribed = true
        }
        else if (status === 'CHANNEL_ERROR') setRealtimeState('error')
        else if (status === 'TIMED_OUT' || status === 'CLOSED') setRealtimeState('disconnected')
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [includeInactive, reload])

  return { addOns, loading, error, realtimeState, reload }
}
