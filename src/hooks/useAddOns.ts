import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AddOn } from '../types/database'

export function useAddOns(options: { includeInactive?: boolean } = {}) {
  const { includeInactive = false } = options
  const [addOns, setAddOns] = useState<AddOn[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    setLoading(true)
    let query = supabase.from('add_ons_catalog').select('*').order('name')
    if (!includeInactive) query = query.eq('active', true)

    query.then(({ data, error }) => {
      if (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to load add-ons', error)
      }
      setAddOns(data ?? [])
      setLoading(false)
    })
  }, [includeInactive])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    const channel = supabase
      .channel(`add-ons-realtime-${includeInactive ? 'all' : 'active'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'add_ons_catalog' },
        () => reload()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [includeInactive, reload])

  return { addOns, loading, reload }
}
