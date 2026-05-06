export type Role = 'admin' | 'manager' | 'employee'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
  is_active: boolean
  created_at: string
}

export type ColumnType = 'text' | 'number' | 'date' | 'dropdown' | 'checkbox' | 'email' | 'phone'

export interface Column {
  id: string
  name: string
  type: ColumnType
  position: number
  is_required: boolean
  created_by: string
  created_at: string
  staff_department?: string // if set, dropdown pulls from crm_staff filtered by department
}

export interface DropdownOption {
  id: string
  column_id: string
  value: string
  color?: string
  position: number
}

export interface Client {
  id: string
  created_at: string
  created_by: string
  updated_at: string
  assigned_to?: string
  deleted: boolean
}

export interface CellValue {
  id: string
  client_id: string
  column_id: string
  value_text?: string | null
  value_number?: number | null
  value_date?: string | null
  value_bool?: boolean | null
  value_dropdown?: string | null // dropdown option id
}

export interface ColumnFilter {
  columnId: string
  value: string
}

export interface AuditEntry {
  id: string
  user_id: string
  user_name: string
  action: string
  entity_type: string
  entity_id?: string
  client_name?: string
  column_name?: string
  old_value?: string
  new_value?: string
  metadata?: Record<string, any>
  created_at: string
}

export interface Tag {
  id: string
  name: string
  color: string
  created_at: string
}

export interface ClientTag {
  client_id: string
  tag_id: string
}

export type ExpenseCategory =
  | 'Заплати'
  | 'Наем'
  | 'Софтуер'
  | 'Реклама'
  | 'Консумативи'
  | 'Комунални'
  | 'Транспорт'
  | 'Обучения'
  | 'Други'

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Заплати', 'Наем', 'Софтуер', 'Реклама', 'Консумативи', 'Комунални', 'Транспорт', 'Обучения', 'Други'
]

export interface Contact {
  id: string
  client_id: string
  owner_name: string | null
  owner_email: string | null
  owner_phone: string | null
  manager_name: string | null
  manager_email: string | null
  company_email: string | null
  eik: string | null
  vat_number: string | null
  address: string | null
  website: string | null
  notes: string | null
  created_at: string
  created_by: string | null
}

export interface ContactWithClient extends Contact {
  client_name: string
}

export interface Expense {
  id: string
  category: ExpenseCategory
  description: string | null
  amount: number
  currency: string
  date: string | null
  staff_id: string | null
  recurring: boolean
  recurring_period: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}


