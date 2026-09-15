// Hand-written types matching supabase/schema.sql.
// If you evolve the schema, run `supabase gen types typescript` instead
// and this file becomes redundant.
//
// Note: Row/Insert/Update types below are all written with `type`, never
// `interface` — supabase-js's generic inference over the Database type
// silently collapses to `never` when a Row is declared as an `interface`
// under this project's tsconfig (bundler resolution). Same shape Supabase's
// own `gen types typescript` produces, and for the same reason.
// Likewise Insert/Update are flat object literals, not
// `Partial<Row> & {...}` intersections, which trips the same collapse.

export type Role = 'owner' | 'staff'
export type PaymentMethod = 'paid' | 'gcash' | 'pay_later'
export type PricingType = 'per_load_by_weight' | 'per_load_manual' | 'per_item'

export type Profile = {
  id: string
  full_name: string
  role: Role
  created_at: string
}

export type Service = {
  id: string
  code: string
  label: string
  default_rate: number | null
  pricing_type: PricingType
  max_kg_per_load: number | null
  active: boolean
  created_at: string
}

export type Transaction = {
  id: string
  transaction_no: number
  customer_name: string
  phone_number: string | null
  transaction_date: string // date
  service_id: string | null
  kg: number | null
  no_of_loads: number | null
  base_amount: number
  add_ons: number
  total_amount: number
  cash_amount: number
  gcash_amount: number
  payment_method: PaymentMethod
  pickup_date: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type TransactionWithService = Transaction & {
  services: Pick<Service, 'code' | 'label'> | null
}

// Minimal Database type so supabase-js typed queries work without the
// full generated schema (fine for a project this size).
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: {
          id: string
          full_name: string
          role?: Role
          created_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          role?: Role
          created_at?: string
        }
        Relationships: []
      }
      services: {
        Row: Service
        Insert: {
          id?: string
          code: string
          label: string
          default_rate?: number | null
          pricing_type?: PricingType
          max_kg_per_load?: number | null
          active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          code?: string
          label?: string
          default_rate?: number | null
          pricing_type?: PricingType
          max_kg_per_load?: number | null
          active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: Transaction
        Insert: {
          id?: string
          transaction_no?: number
          customer_name: string
          phone_number?: string | null
          transaction_date?: string
          service_id?: string | null
          kg?: number | null
          no_of_loads?: number | null
          base_amount?: number
          add_ons?: number
          total_amount?: number
          cash_amount?: number
          gcash_amount?: number
          payment_method?: PaymentMethod
          pickup_date?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          transaction_no?: number
          customer_name?: string
          phone_number?: string | null
          transaction_date?: string
          service_id?: string | null
          kg?: number | null
          no_of_loads?: number | null
          base_amount?: number
          add_ons?: number
          total_amount?: number
          cash_amount?: number
          gcash_amount?: number
          payment_method?: PaymentMethod
          pickup_date?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
