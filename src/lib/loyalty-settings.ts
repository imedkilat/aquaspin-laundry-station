import type { LoyaltySettings } from '../types/database'

export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = {
  id: 1,
  points_per_kg: 1,
  points_required_for_reward: 500,
  reward_description: 'Free Wash & Dry-Fold',
  updated_at: new Date(0).toISOString(),
  updated_by: null,
}

