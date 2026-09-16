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
export type AddOnUnit = 'piece' | 'load' | 'sachet' | 'dose' | 'cycle' | 'kg' | 'flat'

export type Profile = {
  id: string
  full_name: string
  role: Role
  contact_phone: string | null
  avatar_path: string | null
  created_at: string
}

export type ShopSettings = {
  id: number
  shop_display_name: string
  contact_phone: string | null
  report_footer: string | null
  logo_path: string | null
  default_payment_method: PaymentMethod
  default_dashboard_days: number
  require_phone_number: boolean
  require_pickup_date: boolean
  require_notes_for_pay_later: boolean
  allow_manual_total_override: boolean
  staff_can_create_transactions: boolean
  staff_can_access_dashboard: boolean
  staff_can_view_full_history: boolean
  staff_can_edit_transactions: boolean
  staff_can_delete_transactions: boolean
  staff_can_view_historical_pay_later: boolean
  staff_can_edit_own_profile: boolean
  updated_at: string
  updated_by: string | null
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

export type AddOn = {
  id: string
  name: string
  price: number
  unit_type: AddOnUnit
  active: boolean
  created_at: string
  updated_at: string
}

export type TransactionAddOnItem = {
  add_on_id: string
  name: string
  unit_type: AddOnUnit
  unit_price: number
  quantity: number
  line_total: number
}

export type Transaction = {
  id: string
  transaction_no: number
  transaction_code: string
  customer_name: string
  phone_number: string | null
  transaction_date: string // date
  service_id: string | null
  kg: number | null
  no_of_loads: number | null
  base_amount: number
  add_ons: number
  add_on_items: TransactionAddOnItem[]
  total_amount: number
  cash_amount: number
  gcash_amount: number
  gcash_reference: string | null
  payment_method: PaymentMethod
  pickup_date: string | null
  pickup_time: string | null // time, "HH:MM:SS"
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  updated_by: string | null
  client_request_id: string | null
  deleted_at: string | null
  deleted_by: string | null
  delete_reason: string | null
}

export type TransactionWithService = Transaction & {
  services: Pick<Service, 'code' | 'label'> | null
  created_by_profile: Pick<Profile, 'full_name'> | null
  updated_by_profile: Pick<Profile, 'full_name'> | null
  deleted_by_profile: Pick<Profile, 'full_name'> | null
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
          contact_phone?: string | null
          avatar_path?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          role?: Role
          contact_phone?: string | null
          avatar_path?: string | null
          created_at?: string
        }
        Relationships: []
      }
      shop_settings: {
        Row: ShopSettings
        Insert: {
          id?: number
          shop_display_name?: string
          contact_phone?: string | null
          report_footer?: string | null
          logo_path?: string | null
          default_payment_method?: PaymentMethod
          default_dashboard_days?: number
          require_phone_number?: boolean
          require_pickup_date?: boolean
          require_notes_for_pay_later?: boolean
          allow_manual_total_override?: boolean
          staff_can_create_transactions?: boolean
          staff_can_access_dashboard?: boolean
          staff_can_view_full_history?: boolean
          staff_can_edit_transactions?: boolean
          staff_can_delete_transactions?: boolean
          staff_can_view_historical_pay_later?: boolean
          staff_can_edit_own_profile?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          shop_display_name?: string
          contact_phone?: string | null
          report_footer?: string | null
          logo_path?: string | null
          default_payment_method?: PaymentMethod
          default_dashboard_days?: number
          require_phone_number?: boolean
          require_pickup_date?: boolean
          require_notes_for_pay_later?: boolean
          allow_manual_total_override?: boolean
          staff_can_create_transactions?: boolean
          staff_can_access_dashboard?: boolean
          staff_can_view_full_history?: boolean
          staff_can_edit_transactions?: boolean
          staff_can_delete_transactions?: boolean
          staff_can_view_historical_pay_later?: boolean
          staff_can_edit_own_profile?: boolean
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
      add_ons_catalog: {
        Row: AddOn
        Insert: {
          id?: string
          name: string
          price: number
          unit_type?: AddOnUnit
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          price?: number
          unit_type?: AddOnUnit
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: Transaction
        Insert: {
          id?: string
          transaction_no?: number
          transaction_code?: string
          customer_name: string
          phone_number?: string | null
          transaction_date?: string
          service_id?: string | null
          kg?: number | null
          no_of_loads?: number | null
          base_amount?: number
          add_ons?: number
          add_on_items?: TransactionAddOnItem[]
          total_amount?: number
          cash_amount?: number
          gcash_amount?: number
          gcash_reference?: string | null
          payment_method?: PaymentMethod
          pickup_date?: string | null
          pickup_time?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          updated_by?: string | null
          client_request_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          delete_reason?: string | null
        }
        Update: {
          id?: string
          transaction_no?: number
          transaction_code?: string
          customer_name?: string
          phone_number?: string | null
          transaction_date?: string
          service_id?: string | null
          kg?: number | null
          no_of_loads?: number
          base_amount?: number
          add_ons?: number
          add_on_items?: TransactionAddOnItem[]
          total_amount?: number
          cash_amount?: number
          gcash_amount?: number
          gcash_reference?: string | null
          payment_method?: PaymentMethod
          pickup_date?: string | null
          pickup_time?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          updated_by?: string | null
          client_request_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          delete_reason?: string | null
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
