import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { InventoryItem } from '../types/database'

export const LIQUID_DETERGENT_CATEGORY = 'liquid detergent'
export const FABRIC_CONDITIONER_CATEGORY = 'fabric conditioner'

export type InventoryUsageDraft = {
  detergent_item_id: string
  detergent_quantity: string
  fabric_conditioner_item_id: string
  fabric_conditioner_quantity: string
}

export const emptyInventoryUsageDraft = (): InventoryUsageDraft => ({
  detergent_item_id: '',
  detergent_quantity: '',
  fabric_conditioner_item_id: '',
  fabric_conditioner_quantity: '',
})

export function inventoryUsageIsComplete(usage: InventoryUsageDraft) {
  return Boolean(
    usage.detergent_item_id &&
      Number(usage.detergent_quantity) > 0 &&
      usage.fabric_conditioner_item_id &&
      Number(usage.fabric_conditioner_quantity) > 0
  )
}

export function useInventoryConsumables() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [categoryNames, setCategoryNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    const load = async () => {
      setLoading(true)
      setError(null)

      const [categoriesResult, itemsResult] = await Promise.all([
        supabase.from('inventory_categories').select('id, name').eq('active', true).order('name'),
        supabase
          .from('inventory_items')
          .select('id, item_name, category_id, unit_label, reorder_threshold, average_cost, active, notes, created_at, updated_at, created_by, updated_by')
          .eq('active', true)
          .order('item_name'),
      ])

      if (!mounted) return

      const firstError = categoriesResult.error || itemsResult.error
      if (firstError) {
        setError(firstError.message)
        setItems([])
        setCategoryNames(new Map())
        setLoading(false)
        return
      }

      setCategoryNames(new Map((categoriesResult.data ?? []).map((category) => [category.id, category.name.toLowerCase().trim()])))
      setItems((itemsResult.data as InventoryItem[] | null) ?? [])
      setLoading(false)
    }

    void load()
    return () => {
      mounted = false
    }
  }, [])

  const detergentItems = useMemo(
    () => items.filter((item) => categoryNames.get(item.category_id ?? '') === LIQUID_DETERGENT_CATEGORY),
    [categoryNames, items]
  )

  const fabricConditionerItems = useMemo(
    () => items.filter((item) => categoryNames.get(item.category_id ?? '') === FABRIC_CONDITIONER_CATEGORY),
    [categoryNames, items]
  )

  return { detergentItems, fabricConditionerItems, loading, error }
}
