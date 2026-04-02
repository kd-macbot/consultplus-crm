import { supabase } from './supabase'
import type { Client, Column, CellValue, DropdownOption, ColumnType } from './types'

// --- Columns ---
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
  }))
}

export async function addColumn(name: string, type: ColumnType, isRequired = false, createdBy?: string): Promise<Column> {
  // Get max position
  const { data: cols } = await supabase.from('crm_columns').select('position').order('position', { ascending: false }).limit(1)
  const pos = (cols?.[0]?.position ?? -1) + 1
  
  const { data, error } = await supabase
    .from('crm_columns')
    .insert([{ name, type, position: pos, is_required: isRequired, created_by: createdBy }])
    .select()
    .single()
  if (error) throw error
  return data as Column
}

export async function updateColumn(id: string, updates: Partial<Column>) {
  const { error } = await supabase
    .from('crm_columns')
    .update(updates)
    .eq('id', id)
  if (error) throw error
}

export async function deleteColumn(id: string) {
  // Cell values and dropdown options cascade automatically
  const { error } = await supabase
    .from('crm_columns')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// --- Dropdown Options ---
export async function getDropdownOptions(columnId?: string): Promise<DropdownOption[]> {
  let query = supabase.from('crm_dropdown_options').select('*').order('position')
  if (columnId) query = query.eq('column_id', columnId)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function addDropdownOption(columnId: string, value: string, color?: string): Promise<DropdownOption> {
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
  return data as DropdownOption
}

export async function deleteDropdownOption(id: string) {
  const { error } = await supabase
    .from('crm_dropdown_options')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// --- Clients ---
export async function getClients(): Promise<Client[]> {
  const { data, error } = await supabase
    .from('crm_clients')
    .select('*')
    .eq('deleted', false)
    .order('created_at')
  if (error) throw error
  return data ?? []
}

export async function addClient(createdBy?: string, assignedTo?: string): Promise<Client> {
  const { data, error } = await supabase
    .from('crm_clients')
    .insert([{ created_by: createdBy, assigned_to: assignedTo }])
    .select()
    .single()
  if (error) throw error
  return data as Client
}

export async function updateClient(id: string, updates: Partial<Client>) {
  const { error } = await supabase
    .from('crm_clients')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function softDeleteClient(id: string) {
  await updateClient(id, { deleted: true })
}

// --- Cell Values ---
export async function getCellValues(clientId?: string): Promise<CellValue[]> {
  let query = supabase.from('crm_cell_values').select('*')
  if (clientId) query = query.eq('client_id', clientId)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function setCellValue(clientId: string, columnId: string, value: Partial<CellValue>) {
  // Upsert: use unique(client_id, column_id)
  const row = {
    client_id: clientId,
    column_id: columnId,
    value_text: value.value_text ?? null,
    value_number: value.value_number ?? null,
    value_date: value.value_date ?? null,
    value_bool: value.value_bool ?? null,
    value_dropdown: value.value_dropdown ?? null,
  }
  const { error } = await supabase
    .from('crm_cell_values')
    .upsert(row, { onConflict: 'client_id,column_id' })
  if (error) throw error
}

// --- Seed check ---
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
