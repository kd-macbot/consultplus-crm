export type Role = 'admin' | 'manager' | 'employee'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
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
  value_text?: string
  value_number?: number
  value_date?: string
  value_bool?: boolean
  value_dropdown?: string // dropdown option id
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
