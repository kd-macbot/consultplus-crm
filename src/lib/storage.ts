import { supabase } from './supabase'
import type { Client, Column, CellValue, DropdownOption, ColumnType, AuditEntry, Tag, ClientTag, Expense, Contact, ContactWithClient, Profile, Role } from './types'

// ==================== AUDIT LOG ====================

export async function logAudit(
  userId: string | undefined,
  userName: string,
  action: string,
  entityType: string,
  entityId?: string,
  details?: {
    client_name?: string
    column_name?: string
    old_value?: string
    new_value?: string
    metadata?: Record<string, any>
  }
) {
  try {
    await supabase.from('crm_audit_log').insert([{
      user_id: userId ?? null,
      user_name: userName || 'Sistema',
      action,
      entity_type: entityType,
      entity_id: entityId ?? null,
      client_name: details?.client_name ?? null,
      column_name: details?.column_name ?? null,
      old_value: details?.old_value ?? null,
      new_value: details?.new_value ?? null,
      metadata: details?.metadata ?? {},
    }])
  } catch (err) {
    console.error('Audit log error:', err)
  }
}

export async function getAuditLog(
  limit = 50,
  offset = 0,
  filters?: { userId?: string; action?: string; dateFrom?: string; dateTo?: string }
): Promise<{ entries: AuditEntry[]; total: number }> {
  let query = supabase
    .from('crm_audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (filters?.userId) query = query.eq('user_id', filters.userId)
  if (filters?.action) query = query.eq('action', filters.action)
  if (filters?.dateFrom) query = query.gte('created_at', filters.dateFrom)
  if (filters?.dateTo) query = query.lte('created_at', filters.dateTo + 'T23:59:59')

  const { data, error, count } = await query
  if (error) throw error
  return { entries: (data ?? []) as AuditEntry[], total: count ?? 0 }
}

// ==================== COLUMNS ====================

export async function getColumns(): Promise<Column[]> {
  const { data, error } = await supabase
    .from('crm_columns')
    .select('*')
    .order('position')
  if (error) throw error
  return (data ?? []).map(c => ({
    id: c.id,
    name: c.name,
    type: c.type as ColumnType,
    position: c.position,
    is_required: c.is_required,
    created_by: c.created_by,
    created_at: c.created_at,
    staff_department: c.staff_department,
  }))
}

// --- Staff ---
export interface StaffMember {
  id: string
  full_name: string
  department: string | null
  is_active: boolean
}

export async function getStaff(department?: string): Promise<StaffMember[]> {
  let query = supabase.from('crm_staff').select('id,full_name,department,is_active').eq('is_active', true).order('full_name')
  if (department) query = query.eq('department', department)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function createStaffMember(
  member: Record<string, unknown>,
  audit?: { userId?: string; userName?: string }
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('crm_staff')
    .insert([member])
    .select()
    .single()
  if (error) throw error

  if (audit) {
    await logAudit(audit.userId, audit.userName ?? '', 'create_staff', 'staff', data.id, {
      new_value: String(member.full_name ?? ''),
    })
  }
  return data as { id: string }
}

export async function updateStaffMember(
  id: string,
  updates: Record<string, unknown>,
  audit?: { userId?: string; userName?: string; staffName?: string }
): Promise<void> {
  const { error } = await supabase.from('crm_staff').update(updates).eq('id', id)
  if (error) throw error

  if (audit) {
    await logAudit(audit.userId, audit.userName ?? '', 'update_staff', 'staff', id, {
      old_value: audit.staffName,
      new_value: updates.full_name ? String(updates.full_name) : audit.staffName,
    })
  }
}

export async function setStaffActive(
  id: string,
  isActive: boolean,
  audit?: { userId?: string; userName?: string; staffName?: string }
): Promise<void> {
  const { error } = await supabase.from('crm_staff').update({ is_active: isActive }).eq('id', id)
  if (error) throw error

  if (audit) {
    await logAudit(
      audit.userId,
      audit.userName ?? '',
      isActive ? 'activate_staff' : 'deactivate_staff',
      'staff',
      id,
      { old_value: audit.staffName, new_value: audit.staffName }
    )
  }
}

export async function addColumn(
  name: string, type: ColumnType, isRequired = false, createdBy?: string,
  audit?: { userId?: string; userName?: string },
  staffDepartment?: string
): Promise<Column> {
  const { data: cols } = await supabase.from('crm_columns').select('position').order('position', { ascending: false }).limit(1)
  const pos = (cols?.[0]?.position ?? -1) + 1

  const { data, error } = await supabase
    .from('crm_columns')
    .insert([{ name, type, position: pos, is_required: isRequired, created_by: createdBy, staff_department: staffDepartment ?? null }])
    .select()
    .single()
  if (error) throw error

  if (audit) {
    await logAudit(audit.userId, audit.userName ?? '', 'create_column', 'column', data.id, {
      column_name: name,
      new_value: `${name} (${type})`,
    })
  }

  return data as Column
}

export async function updateColumn(id: string, updates: Partial<Column>) {
  const { error } = await supabase
    .from('crm_columns')
    .update(updates)
    .eq('id', id)
  if (error) throw error
}

export async function updateColumnPositions(orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from('crm_columns').update({ position: index }).eq('id', id)
    )
  )
}

export async function deleteColumn(
  id: string,
  audit?: { userId?: string; userName?: string; columnName?: string }
) {
  const { error } = await supabase
    .from('crm_columns')
    .delete()
    .eq('id', id)
  if (error) throw error

  if (audit) {
    await logAudit(audit.userId, audit.userName ?? '', 'delete_column', 'column', id, {
      column_name: audit.columnName,
      old_value: audit.columnName,
    })
  }
}

// ==================== DROPDOWN OPTIONS ====================

export async function getDropdownOptions(columnId?: string): Promise<DropdownOption[]> {
  let query = supabase.from('crm_dropdown_options').select('*').order('position')
  if (columnId) query = query.eq('column_id', columnId)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function addDropdownOption(
  columnId: string, value: string, color?: string,
  audit?: { userId?: string; userName?: string; columnName?: string }
): Promise<DropdownOption> {
  const { data: opts } = await supabase
    .from('crm_dropdown_options')
    .select('position')
    .eq('column_id', columnId)
    .order('position', { ascending: false })
    .limit(1)
  const pos = (opts?.[0]?.position ?? -1) + 1

  const { data, error } = await supabase
    .from('crm_dropdown_options')
    .insert([{ column_id: columnId, value, color, position: pos }])
    .select()
    .single()
  if (error) throw error

  if (audit) {
    await logAudit(audit.userId, audit.userName ?? '', 'create_dropdown_option', 'dropdown', data.id, {
      column_name: audit.columnName,
      new_value: value,
    })
  }

  return data as DropdownOption
}

export async function deleteDropdownOption(
  id: string,
  audit?: { userId?: string; userName?: string; columnName?: string; optionValue?: string }
) {
  const { error } = await supabase
    .from('crm_dropdown_options')
    .delete()
    .eq('id', id)
  if (error) throw error

  if (audit) {
    await logAudit(audit.userId, audit.userName ?? '', 'delete_dropdown_option', 'dropdown', id, {
      column_name: audit.columnName,
      old_value: audit.optionValue,
    })
  }
}

// ==================== CLIENTS ====================

export async function getClients(): Promise<Client[]> {
  const { data, error } = await supabase
    .from('crm_clients')
    .select('*')
    .eq('deleted', false)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function addClient(
  createdBy?: string, assignedTo?: string,
  audit?: { userId?: string; userName?: string }
): Promise<Client> {
  const { data, error } = await supabase
    .from('crm_clients')
    .insert([{ created_by: createdBy, assigned_to: assignedTo }])
    .select()
    .single()
  if (error) throw error

  if (audit) {
    await logAudit(audit.userId, audit.userName ?? '', 'create_client', 'client', data.id)
  }

  return data as Client
}

export async function updateClient(id: string, updates: Partial<Client>) {
  const { error } = await supabase
    .from('crm_clients')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function softDeleteClient(
  id: string,
  audit?: { userId?: string; userName?: string; clientName?: string }
) {
  await updateClient(id, { deleted: true })

  if (audit) {
    await logAudit(audit.userId, audit.userName ?? '', 'delete_client', 'client', id, {
      client_name: audit.clientName,
    })
  }
}

// ==================== CELL VALUES ====================

export async function getCellValues(clientId?: string): Promise<CellValue[]> {
  if (clientId) {
    const { data, error } = await supabase.from('crm_cell_values').select('*').eq('client_id', clientId)
    if (error) throw error
    return data ?? []
  }
  const { count } = await supabase
    .from('crm_cell_values')
    .select('*', { count: 'exact', head: true })
  const total = count ?? 0
  if (total === 0) return []
  const PAGE = 1000
  const pages = Math.ceil(total / PAGE)
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      supabase.from('crm_cell_values').select('*').range(i * PAGE, (i + 1) * PAGE - 1)
    )
  )
  return results.flatMap(r => r.data ?? []) as CellValue[]
}

export async function setCellValue(
  clientId: string, columnId: string, value: Partial<CellValue>,
  audit?: { userId?: string; userName?: string; clientName?: string; columnName?: string; oldDisplay?: string; newDisplay?: string }
) {
  const updates = {
    value_text: value.value_text ?? null,
    value_number: value.value_number ?? null,
    value_date: value.value_date ?? null,
    value_bool: value.value_bool ?? null,
    value_dropdown: value.value_dropdown ?? null,
  }

  const { data: existing } = await supabase
    .from('crm_cell_values')
    .select('id')
    .eq('client_id', clientId)
    .eq('column_id', columnId)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('crm_cell_values')
      .update(updates)
      .eq('id', existing.id)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('crm_cell_values')
      .insert([{ client_id: clientId, column_id: columnId, ...updates }])
    if (error) throw error
  }

  if (audit) {
    await logAudit(audit.userId, audit.userName ?? '', 'update_cell', 'cell', clientId, {
      client_name: audit.clientName,
      column_name: audit.columnName,
      old_value: audit.oldDisplay,
      new_value: audit.newDisplay,
    })
  }
}

// ==================== TAGS ====================

export async function getTags(): Promise<Tag[]> {
  const { data, error } = await supabase
    .from('crm_tags')
    .select('*')
    .order('name')
  if (error) throw error
  return (data ?? []) as Tag[]
}

export async function createTag(
  name: string, color: string,
  audit?: { userId?: string; userName?: string }
): Promise<Tag> {
  const { data, error } = await supabase
    .from('crm_tags')
    .insert([{ name, color }])
    .select()
    .single()
  if (error) throw error

  if (audit) {
    await logAudit(audit.userId, audit.userName ?? '', 'create_tag', 'tag', data.id, {
      new_value: name,
    })
  }

  return data as Tag
}

export async function deleteTag(
  id: string,
  audit?: { userId?: string; userName?: string; tagName?: string }
) {
  const { error } = await supabase.from('crm_tags').delete().eq('id', id)
  if (error) throw error

  if (audit) {
    await logAudit(audit.userId, audit.userName ?? '', 'delete_tag', 'tag', id, {
      old_value: audit.tagName,
    })
  }
}

export async function addTagToClient(
  clientId: string, tagId: string,
  audit?: { userId?: string; userName?: string; clientName?: string; tagName?: string }
) {
  const { error } = await supabase
    .from('crm_client_tags')
    .insert([{ client_id: clientId, tag_id: tagId }])
  if (error) throw error

  if (audit) {
    await logAudit(audit.userId, audit.userName ?? '', 'add_tag', 'client', clientId, {
      client_name: audit.clientName,
      new_value: audit.tagName,
    })
  }
}

export async function removeTagFromClient(
  clientId: string, tagId: string,
  audit?: { userId?: string; userName?: string; clientName?: string; tagName?: string }
) {
  const { error } = await supabase
    .from('crm_client_tags')
    .delete()
    .eq('client_id', clientId)
    .eq('tag_id', tagId)
  if (error) throw error

  if (audit) {
    await logAudit(audit.userId, audit.userName ?? '', 'remove_tag', 'client', clientId, {
      client_name: audit.clientName,
      old_value: audit.tagName,
    })
  }
}

export async function getClientTags(): Promise<ClientTag[]> {
  const { data, error } = await supabase.from('crm_client_tags').select('*')
  if (error) throw error
  return (data ?? []) as ClientTag[]
}

// ==================== EXPENSES ====================

export async function getExpenses(): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('crm_expenses')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Expense[]
}

export async function addExpense(
  expense: Omit<Expense, 'id' | 'created_at' | 'updated_at'>,
  audit?: { userId?: string; userName?: string }
): Promise<Expense> {
  const { data, error } = await supabase
    .from('crm_expenses')
    .insert([expense])
    .select()
    .single()
  if (error) {
    const code = (error as any)?.code
    const message = (error as any)?.message ?? ''
    if (code === '42P01' || (message.includes('crm_expenses') && message.includes('does not exist'))) {
      throw new Error('Таблицата за разходи не е създадена. Моля пуснете migration-004.')
    }
    throw error
  }

  if (audit) {
    await logAudit(audit.userId, audit.userName ?? '', 'create_expense', 'expense', data.id, {
      new_value: `${expense.category}: ${expense.amount} ${expense.currency}`,
    })
  }

  return data as Expense
}

export async function updateExpense(
  id: string,
  updates: Partial<Expense>,
  audit?: { userId?: string; userName?: string; oldDescription?: string }
): Promise<void> {
  const { error } = await supabase
    .from('crm_expenses')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error

  if (audit) {
    await logAudit(audit.userId, audit.userName ?? '', 'update_expense', 'expense', id, {
      old_value: audit.oldDescription,
      new_value: updates.category ? `${updates.category}: ${updates.amount} ${updates.currency ?? 'EUR'}` : undefined,
    })
  }
}

export async function deleteExpense(
  id: string,
  audit?: { userId?: string; userName?: string; description?: string }
): Promise<void> {
  const { error } = await supabase
    .from('crm_expenses')
    .delete()
    .eq('id', id)
  if (error) throw error

  if (audit) {
    await logAudit(audit.userId, audit.userName ?? '', 'delete_expense', 'expense', id, {
      old_value: audit.description,
    })
  }
}

// ==================== CONTACTS ====================

export async function getClientNames(): Promise<{ id: string; name: string }[]> {
  const { data: clients, error } = await supabase
    .from('crm_clients')
    .select('id')
    .eq('deleted', false)
    .order('created_at')
  if (error) throw error
  const clientIds = (clients ?? []).map((c: any) => c.id)
  if (clientIds.length === 0) return []

  const { data: cols } = await supabase
    .from('crm_columns')
    .select('id')
    .eq('type', 'text')
    .order('position')
    .limit(1)
  const nameColId = cols?.[0]?.id
  if (!nameColId) return clientIds.map((id: string) => ({ id, name: '—' }))

  const { data: cells } = await supabase
    .from('crm_cell_values')
    .select('client_id, value_text')
    .eq('column_id', nameColId)
    .in('client_id', clientIds)
  const nameMap: Record<string, string> = {}
  cells?.forEach((c: any) => { nameMap[c.client_id] = c.value_text ?? '' })
  return clientIds.map((id: string) => ({ id, name: nameMap[id] || '—' }))
}

export async function getContactsWithClients(): Promise<ContactWithClient[]> {
  const { data, error } = await supabase
    .from('crm_contacts')
    .select('*, crm_clients(id, created_at)')
    .order('created_at', { ascending: false })
  if (error) throw error

  const clientIds = (data ?? []).map((r: any) => r.client_id)
  if (clientIds.length === 0) return []

  const { data: cols } = await supabase
    .from('crm_columns')
    .select('id, name, type')
    .eq('type', 'text')
    .order('position')

  const nameColId = cols?.[0]?.id

  let nameMap: Record<string, string> = {}
  if (nameColId) {
    const { data: cells } = await supabase
      .from('crm_cell_values')
      .select('client_id, value_text')
      .eq('column_id', nameColId)
      .in('client_id', clientIds)
    cells?.forEach((c: any) => { nameMap[c.client_id] = c.value_text ?? '' })
  }

  return (data ?? []).map((r: any) => ({
    ...r,
    client_name: nameMap[r.client_id] ?? r.client_id,
  })) as ContactWithClient[]
}

export async function getContactByClientId(clientId: string): Promise<Contact | null> {
  const { data, error } = await supabase
    .from('crm_contacts')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw error
  return data as Contact | null
}

export async function upsertContact(
  contact: Omit<Contact, 'id' | 'created_at'> & { id?: string }
): Promise<void> {
  const { error } = await supabase
    .from('crm_contacts')
    .upsert(contact, { onConflict: 'client_id' })
  if (error) throw error
}

export async function deleteContact(id: string): Promise<void> {
  const { error } = await supabase
    .from('crm_contacts')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ==================== PROFILES ====================

export async function getProfiles(): Promise<{ id: string; full_name: string }[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .order('full_name')
  if (error) throw error
  return data ?? []
}

export async function getAllProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Profile[]
}

export async function updateProfile(
  id: string,
  patch: { full_name?: string; role?: Role; is_active?: boolean }
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', id)
  if (error) throw error
}

export async function createProfileRecord(
  id: string,
  email: string,
  full_name: string,
  role: Role
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .upsert({ id, email, full_name, role, is_active: true })
  if (error) throw error
}

// ==================== SEED / DATA ====================

export async function isSeeded(): Promise<boolean> {
  const { count, error } = await supabase
    .from('crm_columns')
    .select('*', { count: 'exact', head: true })
  if (error) return false
  return (count ?? 0) > 0
}

export async function clearAll() {
  await supabase.from('crm_cell_values').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('crm_clients').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('crm_dropdown_options').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('crm_columns').delete().neq('id', '00000000-0000-0000-0000-000000000000')
}
