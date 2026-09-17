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

import type { Customer, CustomerSummary, OrderStatus, TransactionStatusHistory } from './customer-status'

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
  address: string | null
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
  staff_can_manage_customers: boolean
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


export type InventoryUnit = 'pcs' | 'ml' | 'L' | 'g' | 'kg'
export type InventoryMovementType = 'stock_in' | 'adjustment' | 'consumption' | 'wastage' | 'correction'

export type InventoryCategory = {
  id: string
  name: string
  active: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type InventoryItem = {
  id: string
  item_name: string
  category_id: string | null
  unit_label: InventoryUnit
  reorder_threshold: number
  average_cost: number
  active: boolean
  notes: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type InventoryStockMovement = {
  id: string
  item_id: string
  movement_type: InventoryMovementType
  quantity_delta: number
  unit_cost: number | null
  reason: string
  created_at: string
  created_by: string | null
}

export type InventoryItemSummary = {
  id: string
  item_name: string
  category_id: string | null
  category_name: string | null
  unit_label: InventoryUnit
  reorder_threshold: number
  average_cost: number
  active: boolean
  notes: string | null
  created_at: string
  updated_at: string
  current_quantity: number
  stock_value: number
  last_movement_at: string
}

export type ExpenseCategory = {
  id: string
  name: string
  active: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type Expense = {
  id: string
  expense_date: string
  category_id: string | null
  description: string
  amount: number
  vendor: string | null
  notes: string | null
  created_at: string
  created_by: string | null
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
}

export type ActiveExpense = {
  id: string
  expense_date: string
  category_id: string | null
  category_name: string | null
  description: string
  amount: number
  vendor: string | null
  notes: string | null
  created_at: string
  created_by: string | null
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
  customer_id: string | null
  service_code_snapshot: string | null
  service_label_snapshot: string | null
  order_status: OrderStatus
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
      customers: {
        Row: Customer
        Insert: { full_name: string; phone_number?: string | null; notes?: string | null; active?: boolean }
        Update: { full_name?: string; phone_number?: string | null; notes?: string | null; active?: boolean }
        Relationships: []
      }
      transaction_status_history: {
        Row: TransactionStatusHistory
        Insert: { [key: string]: never }
        Update: { [key: string]: never }
        Relationships: []
      }
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
          address?: string | null
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
          staff_can_manage_customers?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          shop_display_name?: string
          contact_phone?: string | null
          address?: string | null
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
          staff_can_manage_customers?: boolean
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
      inventory_categories: {
        Row: InventoryCategory
        Insert: {
          id?: string
          name: string
          active?: boolean
          created_at?: string
          updated_at?: string
          created_by: string
          updated_by?: string | null
        }
        Update: {
          name?: string
          active?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      inventory_items: {
        Row: InventoryItem
        Insert: {
          id?: string
          item_name: string
          category_id?: string | null
          unit_label: InventoryUnit
          reorder_threshold?: number
          average_cost?: number
          active?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
          created_by: string
          updated_by?: string | null
        }
        Update: {
          item_name?: string
          category_id?: string | null
          unit_label?: InventoryUnit
          reorder_threshold?: number
          average_cost?: number
          active?: boolean
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      inventory_stock_movements: {
        Row: InventoryStockMovement
        Insert: { [key: string]: never }
        Update: { [key: string]: never }
        Relationships: []
      }

      expense_categories: {
        Row: ExpenseCategory
        Insert: {
          id?: string
          name: string
          active?: boolean
          created_at?: string
          updated_at?: string
          created_by: string
          updated_by?: string | null
        }
        Update: {
          name?: string
          active?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      expenses: {
        Row: Expense
        Insert: { [key: string]: never }
        Update: { [key: string]: never }
        Relationships: []
      }
      transactions: {
        Row: Transaction
        Insert: {
          id?: string
          transaction_no?: number
          transaction_code?: string
          customer_name: string
          customer_id?: string | null
          service_code_snapshot?: string | null
          service_label_snapshot?: string | null
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
          customer_id?: string | null
          service_code_snapshot?: string | null
          service_label_snapshot?: string | null
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
        Relationships: []
      }
    }
    Views: {
      customer_summary: { Row: CustomerSummary; Relationships: [] }
      customer_transaction_history: { Row: Transaction; Relationships: [] }
      inventory_item_summary: { Row: InventoryItemSummary; Relationships: [] }
      active_expenses: { Row: ActiveExpense; Relationships: [] }
    }
    Functions: {
      record_expense: {
        Args: {
          p_description: string
          p_amount: number
          p_expense_date?: string
          p_category_id?: string | null
          p_vendor?: string | null
          p_notes?: string | null
        }
        Returns: Expense
      }
      void_expense: {
        Args: {
          p_expense_id: string
          p_reason: string
        }
        Returns: Expense
      }
      record_inventory_movement: {
        Args: {
          p_item_id: string
          p_movement_type: InventoryMovementType
          p_quantity_delta: number
          p_reason: string
          p_unit_cost?: number | null
        }
        Returns: InventoryStockMovement
      }
      normalize_customer_phone: { Args: { p_phone: string }; Returns: string | null }
      set_transaction_status: {
        Args: {
          p_transaction_id: string
          p_status: OrderStatus
          p_expected_updated_at: string
          p_reason?: string | null
          p_override?: boolean
        }
        Returns: Transaction
      }
      soft_delete_transaction: {
        Args: {
          p_transaction_id: string
          p_expected_updated_at: string
          p_delete_reason: string
        }
        Returns: { success: boolean; transaction_id: string; updated_at: string }[]
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

