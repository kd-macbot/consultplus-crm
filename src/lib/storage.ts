import { supabase } from './supabase'
import type { Client, Column, CellValue, DropdownOption, ColumnType, AuditEntry, Tag, ClientTag, Expense, Contact, ContactWithClient, Profile, Role, Opportunity, MonthlyWork, Art55Entry, Art55QuarterStatus, TrzWork } from './types'

/**
 * Retry helper за четящи заявки с TIMEOUT — решава „понякога не зарежда и
 * иска рефреш". Две защити:
 *  1. timeout — ако заявката зависне (мрежова връзка станала stale, напр.
 *     след връщане от заспал таб), се прекъсва след timeoutMs и се повтаря с
 *     нова заявка, вместо да виси безкрай.
 *  2. retry — повтаря при грешка/timeout с exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelay = 300,
  timeoutMs = 12000,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs)
    } catch (err) {
      lastErr = err
      if (attempt === retries) break
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)))
    }
  }
  throw lastErr
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Заявката изтече (timeout)')), ms)
    p.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

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
  return withRetry(async () => {
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
  })
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

/**
 * Свързва или развързва dropdown колона с отдел от персонала.
 * При свързване — мигрира съществуващите value_dropdown → value_text
 * (използва текста на dropdown опцията), за да се запазят данните.
 * При развързване — оставя value_text-овете (потребителят може да създаде
 * нови dropdown options ръчно).
 */
export async function setColumnStaffDepartment(columnId: string, department: string | null): Promise<void> {
  if (department) {
    // Прехвърляме value_dropdown → value_text за всички съществуващи cells в тази колона
    const { data: cells, error: cellsErr } = await supabase
      .from('crm_cell_values')
      .select('id, value_dropdown')
      .eq('column_id', columnId)
      .not('value_dropdown', 'is', null)
    if (cellsErr) throw cellsErr

    if (cells && cells.length > 0) {
      const optionIds = [...new Set(cells.map(c => c.value_dropdown).filter(Boolean) as string[])]
      const { data: opts, error: optsErr } = await supabase
        .from('crm_dropdown_options')
        .select('id, value')
        .in('id', optionIds)
      if (optsErr) throw optsErr

      const optMap = new Map((opts ?? []).map(o => [o.id, o.value]))
      await Promise.all(cells.map(cell => {
        const text = cell.value_dropdown ? optMap.get(cell.value_dropdown) ?? null : null
        return supabase
          .from('crm_cell_values')
          .update({ value_text: text, value_dropdown: null })
          .eq('id', cell.id)
      }))
    }
  }
  // Нулирането изисква DB null, а не undefined — пишем директно
  const { error } = await supabase
    .from('crm_columns')
    .update({ staff_department: department })
    .eq('id', columnId)
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
  return withRetry(async () => {
    let query = supabase.from('crm_dropdown_options').select('*').order('position')
    if (columnId) query = query.eq('column_id', columnId)
    const { data, error } = await query
    if (error) throw error
    return data ?? []
  })
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
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('crm_clients')
      .select('*')
      .eq('deleted', false)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data ?? []
  })
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
  return withRetry(async () => {
    if (clientId) {
      const { data, error } = await supabase.from('crm_cell_values').select('*').eq('client_id', clientId)
      if (error) throw error
      return data ?? []
    }
    // Един тур: взимаме редовете + точния общ брой в една заявка (count идва
    // в Content-Range хедъра, без отделна count заявка). Ако db max_rows стига
    // за всички редове → това е единствената заявка. Ако базата е орязала
    // отговора, доваждаме останалите страници паралелно. Подреждаме по id за
    // стабилна пагинация.
    const t0 = performance.now()
    const { data, count, error } = await supabase
      .from('crm_cell_values')
      .select('*', { count: 'exact' })
      .order('id', { ascending: true })
    if (error) throw error
    const first = (data ?? []) as CellValue[]
    const total = count ?? first.length
    if (first.length >= total) {
      console.info(`%c[perf]%c   cells.load тур: ${Math.round(performance.now() - t0)}ms (${first.length} реда, 1 заявка)`, 'color:#b8860b;font-weight:bold', 'color:inherit')
      return first
    }
    const PAGE = first.length || 1000
    const extraPages = Math.ceil((total - first.length) / PAGE)
    const rest = await Promise.all(
      Array.from({ length: extraPages }, (_, i) => {
        const start = first.length + i * PAGE
        return supabase
          .from('crm_cell_values')
          .select('*')
          .order('id', { ascending: true })
          .range(start, start + PAGE - 1)
      })
    )
    console.info(`%c[perf]%c   cells.load тур: ${Math.round(performance.now() - t0)}ms (${total} реда, ${1 + extraPages} заявки)`, 'color:#b8860b;font-weight:bold', 'color:inherit')
    return [...first, ...rest.flatMap(r => (r.data ?? []) as CellValue[])]
  })
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
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('crm_expenses')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as Expense[]
  })
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
  return withRetry(() => _getContactsWithClients())
}

async function _getContactsWithClients(): Promise<ContactWithClient[]> {
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

export async function getAllContacts(): Promise<Contact[]> {
  const { data, error } = await supabase
    .from('crm_contacts')
    .select('*')
  if (error) throw error
  return (data ?? []) as Contact[]
}

export async function upsertContact(
  contact: Omit<Contact, 'id' | 'created_at'> & { id?: string }
): Promise<void> {
  const { error } = await supabase
    .from('crm_contacts')
    .upsert(contact, { onConflict: 'client_id' })
  if (error) throw error
}

/**
 * Build a complete contact upsert payload by merging `existing` values with `patch`.
 * Eliminates 12-line boilerplate at each call site and guarantees no field is forgotten.
 */
export function buildContactPayload(
  clientId: string,
  existing: Contact | null | undefined,
  patch: Partial<Omit<Contact, 'id' | 'created_at' | 'client_id'>>,
  userId?: string | null,
): Omit<Contact, 'id' | 'created_at'> & { id?: string } {
  const base: Omit<Contact, 'id' | 'created_at'> = {
    client_id: clientId,
    owner_name: existing?.owner_name ?? null,
    owner_email: existing?.owner_email ?? null,
    owner_phone: existing?.owner_phone ?? null,
    manager_name: existing?.manager_name ?? null,
    manager_email: existing?.manager_email ?? null,
    company_email: existing?.company_email ?? null,
    eik: existing?.eik ?? null,
    vat_number: existing?.vat_number ?? null,
    vat_registered_at: existing?.vat_registered_at ?? null,
    address: existing?.address ?? null,
    website: existing?.website ?? null,
    public_url: existing?.public_url ?? null,
    notes: existing?.notes ?? null,
    created_by: existing?.created_by ?? userId ?? null,
  }
  const merged = { ...base, ...patch }
  return existing?.id ? { ...merged, id: existing.id } : merged
}

export async function deleteContact(id: string): Promise<void> {
  const { error } = await supabase
    .from('crm_contacts')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export interface EikLookupFields {
  eik: string | null
  vat_number: string | null
  vat_registered_at: string | null
  address: string | null
  owner_name: string | null
  manager_name: string | null
  public_url: string | null
}

export interface EikLookupResult {
  eik: string | null
  caption: string | null
  total: number
  candidates: Array<{ identifier: string; caption: string; activity: number }>
  fields: EikLookupFields | null
}

async function invokeEdge<T = unknown>(body: object): Promise<T> {
  const { data, error } = await supabase.functions.invoke('swift-task', { body })
  if (error) {
    // FunctionsHttpError носи body-то на отговора в .context (Response). Извличаме реалното съобщение.
    const ctx = (error as any).context
    if (ctx && typeof ctx.text === 'function') {
      try {
        const text = await ctx.text()
        try {
          const parsed = JSON.parse(text)
          throw new Error(parsed?.error ?? text ?? error.message)
        } catch {
          throw new Error(text || error.message)
        }
      } catch (e) {
        if (e instanceof Error && e.message !== error.message) throw e
      }
    }
    throw error
  }
  if ((data as any)?.error) throw new Error((data as any).error)
  return data as T
}

async function invokeFetchEik(body: object): Promise<EikLookupResult> {
  return invokeEdge<EikLookupResult>(body)
}

export async function lookupEikByName(name: string): Promise<EikLookupResult> {
  // Slug-ът на функцията в Supabase е "swift-task" (auto-генериран), но името й е "fetch-eik".
  // URL-ът използва slug. verify_jwt=false е настроен, така че supabase.functions.invoke работи нормално.
  return invokeFetchEik({ name })
}

export async function lookupByEik(eik: string): Promise<EikLookupResult> {
  return invokeFetchEik({ eik })
}

export async function fetchEikRaw(eik: string): Promise<unknown> {
  // Диагностичен режим — връща суровия отговор от regdata data/fetch
  return invokeEdge({ fetchEik: eik })
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

// ==================== OPPORTUNITIES ====================

export async function getOpportunities(): Promise<Opportunity[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('crm_opportunities')
      .select('*')
      .eq('deleted', false)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as Opportunity[]
  })
}

export async function addOpportunity(
  patch: Partial<Omit<Opportunity, 'id' | 'created_at' | 'updated_at' | 'deleted'>> & { name: string }
): Promise<Opportunity> {
  const { data, error } = await supabase
    .from('crm_opportunities')
    .insert([patch])
    .select()
    .single()
  if (error) throw error
  return data as Opportunity
}

export async function updateOpportunity(id: string, patch: Partial<Opportunity>): Promise<void> {
  const { error } = await supabase
    .from('crm_opportunities')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function softDeleteOpportunity(id: string): Promise<void> {
  await updateOpportunity(id, { deleted: true })
}

/**
 * Конвертира opportunity в client: създава нов client, копира името в първата text колона,
 * създава контакт с цялата информация и маркира opportunity-то като конвертирано.
 */
export async function convertOpportunityToClient(
  opp: Opportunity,
  userId?: string,
  userName?: string,
): Promise<{ clientId: string }> {
  // 1. Нов клиент
  const client = await addClient(userId, undefined, { userId, userName })

  // 2. Името в първата text колона
  const cols = await getColumns()
  const nameCol = cols.find(c => c.type === 'text')
  if (nameCol && opp.name) {
    await setCellValue(client.id, nameCol.id, { value_text: opp.name })
  }
  // 3. Отговорник в колоната „Отговорник" (ако е попълнен)
  if (opp.responsible) {
    const respCol = cols.find(c => c.name === 'Отговорник')
    if (respCol) {
      await setCellValue(client.id, respCol.id, { value_text: opp.responsible })
    }
  }

  // 4. Контакт с попълнени данни
  await upsertContact(buildContactPayload(client.id, null, {
    eik: opp.eik,
    vat_number: opp.vat_number,
    vat_registered_at: opp.vat_registered_at,
    address: opp.address,
    public_url: opp.public_url,
    owner_name: opp.owner_name_legal,
    manager_name: opp.manager_name_legal,
    owner_email: opp.contact_email,
    owner_phone: opp.contact_phone,
    notes: opp.notes,
  }, userId))

  // 5. Маркираме opportunity-то
  await updateOpportunity(opp.id, {
    converted_to_client_id: client.id,
    converted_at: new Date().toISOString(),
    stage: 'Печеливш',
  })

  // 6. Audit log
  await logAudit(userId, userName ?? '', 'convert_opportunity', 'opportunity', opp.id, {
    client_name: opp.name,
    new_value: client.id,
    metadata: { eik: opp.eik },
  })

  return { clientId: client.id }
}

// ==================== MONTHLY WORK ====================

export async function getMonthlyWorkForYear(year: number): Promise<MonthlyWork[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('crm_monthly_work')
      .select('*')
      .eq('year', year)
    if (error) throw error
    return (data ?? []) as MonthlyWork[]
  })
}

export async function getMonthlyWork(year: number, month: number): Promise<MonthlyWork[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('crm_monthly_work')
      .select('*')
      .eq('year', year)
      .eq('month', month)
    if (error) throw error
    return (data ?? []) as MonthlyWork[]
  })
}

/**
 * Уверява се, че за всеки от подадените client_ids има ред за дадения месец.
 * Връща броя на новосъздадените редове. Безопасна да се вика многократно
 * (ползва UNIQUE constraint client_id+year+month).
 */
export async function ensureMonthlyRows(
  clientIds: string[],
  year: number,
  month: number,
  createdBy?: string,
): Promise<number> {
  if (clientIds.length === 0) return 0
  // Намираме съществуващите за този месец
  const { data: existing, error: existingErr } = await supabase
    .from('crm_monthly_work')
    .select('client_id')
    .eq('year', year)
    .eq('month', month)
    .in('client_id', clientIds)
  if (existingErr) throw existingErr

  const existingSet = new Set((existing ?? []).map(r => r.client_id))
  const missing = clientIds.filter(id => !existingSet.has(id))
  if (missing.length === 0) return 0

  const rows = missing.map(client_id => ({
    client_id,
    year,
    month,
    created_by: createdBy ?? null,
  }))
  const { error: insErr } = await supabase.from('crm_monthly_work').insert(rows)
  if (insErr) throw insErr
  return missing.length
}

// ОСС суми за избрани месеци (за сбор на тримесечие в Работния лист).
export async function getOssAmounts(
  year: number,
  months: number[],
): Promise<{ client_id: string; month: number; oss_amount: number | null }[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('crm_monthly_work')
      .select('client_id, month, oss_amount')
      .eq('year', year)
      .in('month', months)
    if (error) throw error
    return (data ?? []) as { client_id: string; month: number; oss_amount: number | null }[]
  })
}

export async function updateMonthlyWork(id: string, patch: Partial<MonthlyWork>): Promise<void> {
  const { error } = await supabase
    .from('crm_monthly_work')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/**
 * Upsert по (client_id, year, month) — полезно за редове, които току що са
 * създадени, но id-то не е известно (напр. след ensureMonthlyRows + редакция).
 */
export async function upsertMonthlyWorkByKey(
  clientId: string,
  year: number,
  month: number,
  patch: Partial<MonthlyWork>,
  createdBy?: string,
): Promise<void> {
  const { error } = await supabase
    .from('crm_monthly_work')
    .upsert(
      { client_id: clientId, year, month, created_by: createdBy ?? null, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'client_id,year,month' },
    )
  if (error) throw error
}

// ==================== ТРЗ МЕСЕЧЕН ЛИСТ ====================

export async function getTrzWork(year: number, month: number): Promise<TrzWork[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('crm_trz_work')
      .select('*')
      .eq('year', year)
      .eq('month', month)
    if (error) throw error
    return (data ?? []) as TrzWork[]
  })
}

/** Уверява се, че за всеки client_id има ТРЗ ред за месеца. Връща броя нови. */
export async function ensureTrzRows(
  clientIds: string[],
  year: number,
  month: number,
  createdBy?: string,
): Promise<number> {
  if (clientIds.length === 0) return 0
  const { data: existing, error: existingErr } = await supabase
    .from('crm_trz_work')
    .select('client_id')
    .eq('year', year)
    .eq('month', month)
    .in('client_id', clientIds)
  if (existingErr) throw existingErr

  const existingSet = new Set((existing ?? []).map(r => r.client_id))
  const missing = clientIds.filter(id => !existingSet.has(id))
  if (missing.length === 0) return 0

  // Бележката се „пренася" от предходния месец — новият ред стартира с нея.
  const py = month === 1 ? year - 1 : year
  const pm = month === 1 ? 12 : month - 1
  const { data: prev } = await supabase
    .from('crm_trz_work')
    .select('client_id, notes')
    .eq('year', py)
    .eq('month', pm)
    .in('client_id', missing)
  const prevNote = new Map((prev ?? []).map(r => [r.client_id, r.notes as string | null]))

  const rows = missing.map(client_id => ({
    client_id, year, month,
    created_by: createdBy ?? null,
    notes: prevNote.get(client_id) ?? null,
  }))
  const { error: insErr } = await supabase.from('crm_trz_work').insert(rows)
  if (insErr) throw insErr
  return missing.length
}

/** Upsert по (client_id, year, month) — за редове създадени, но без известен id. */
export async function upsertTrzWorkByKey(
  clientId: string,
  year: number,
  month: number,
  patch: Partial<TrzWork>,
  createdBy?: string,
): Promise<void> {
  const { error } = await supabase
    .from('crm_trz_work')
    .upsert(
      { client_id: clientId, year, month, created_by: createdBy ?? null, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'client_id,year,month' },
    )
  if (error) throw error
}

// ==================== ART. 55 ENTRIES ====================

export async function getArt55EntriesForPeriod(year: number, months: number[]): Promise<Art55Entry[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('crm_art55_entries')
      .select('*')
      .eq('year', year)
      .in('month', months)
      .order('position')
    if (error) throw error
    return (data ?? []) as Art55Entry[]
  })
}

export async function addArt55Entry(row: {
  client_id: string; year: number; month: number;
  gross_amount?: number; tax_amount?: number; income_type?: string | null;
  createdBy?: string;
}): Promise<Art55Entry> {
  const { data: existing } = await supabase
    .from('crm_art55_entries')
    .select('position')
    .eq('client_id', row.client_id).eq('year', row.year).eq('month', row.month)
    .order('position', { ascending: false }).limit(1)
  const pos = (existing?.[0]?.position ?? -1) + 1

  const { data, error } = await supabase
    .from('crm_art55_entries')
    .insert([{
      client_id: row.client_id, year: row.year, month: row.month,
      gross_amount: row.gross_amount ?? 0,
      tax_amount: row.tax_amount ?? 0,
      income_type: row.income_type ?? null,
      position: pos,
      created_by: row.createdBy ?? null,
    }])
    .select().single()
  if (error) throw error
  return data as Art55Entry
}

export async function updateArt55Entry(id: string, patch: Partial<Art55Entry>): Promise<void> {
  const { error } = await supabase
    .from('crm_art55_entries')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteArt55Entry(id: string): Promise<void> {
  const { error } = await supabase.from('crm_art55_entries').delete().eq('id', id)
  if (error) throw error
}

// ==================== ART. 55 QUARTERLY STATUS ====================

export async function getArt55QuarterStatuses(year: number): Promise<Art55QuarterStatus[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('crm_art55_quarter_status').select('*').eq('year', year)
    if (error) throw error
    return (data ?? []) as Art55QuarterStatus[]
  })
}

export async function upsertArt55QuarterStatus(
  clientId: string, year: number, quarter: number, patch: Partial<Art55QuarterStatus>,
): Promise<void> {
  const { error } = await supabase
    .from('crm_art55_quarter_status')
    .upsert(
      { client_id: clientId, year, quarter, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'client_id,year,quarter' },
    )
  if (error) throw error
}
