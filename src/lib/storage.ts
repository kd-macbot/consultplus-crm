import { supabase } from './supabase'
import type { Client, Column, CellValue, DropdownOption, ColumnType, AuditEntry, Tag, ClientTag } from './types'

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
      user_name: userName || 'Система',
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

export async function addColumn(
  name: string, type: ColumnType, isRequired = false, createdBy?: string,
  audit?: { userId?: string; userName?: string }
): Promise<Column> {
  const { data: cols } = await supabase.from('crm_columns').select('position').order('position', { ascending: false }).limit(1)
  const pos = (cols?.[0]?.position ?? -1) + 1

  const { data, error } = await supabase
    .from('crm_columns')
    .insert([{ name, type, position: pos, is_required: isRequired, created_by: createdBy }])
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
    .order('created_at')
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
  let all: CellValue[] = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('crm_cell_values')
      .select('*')
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
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

// ==================== PROFILES (for audit filter) ====================

export async function getProfiles(): Promise<{ id: string; full_name: string }[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .order('full_name')
  if (error) throw error
  return data ?? []
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
