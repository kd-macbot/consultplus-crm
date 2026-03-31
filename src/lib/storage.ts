import type { Client, Column, CellValue, DropdownOption, ColumnType } from './types'
import { v4 as uuid } from 'uuid'

const KEYS = {
  clients: 'cp_clients',
  columns: 'cp_columns',
  cells: 'cp_cells',
  dropdowns: 'cp_dropdowns',
  seeded: 'cp_seeded',
}

function get<T>(key: string): T[] {
  const raw = localStorage.getItem(key)
  return raw ? JSON.parse(raw) : []
}
function set<T>(key: string, data: T[]) {
  localStorage.setItem(key, JSON.stringify(data))
}

// --- Columns ---
export function getColumns(): Column[] {
  return get<Column>(KEYS.columns).sort((a, b) => a.position - b.position)
}
export function saveColumns(cols: Column[]) { set(KEYS.columns, cols) }
export function addColumn(name: string, type: ColumnType, isRequired = false, createdBy = '1'): Column {
  const cols = getColumns()
  const col: Column = { id: uuid(), name, type, position: cols.length, is_required: isRequired, created_by: createdBy, created_at: new Date().toISOString() }
  cols.push(col)
  saveColumns(cols)
  return col
}
export function updateColumn(id: string, updates: Partial<Column>) {
  const cols = getColumns().map(c => c.id === id ? { ...c, ...updates } : c)
  saveColumns(cols)
}
export function deleteColumn(id: string) {
  saveColumns(getColumns().filter(c => c.id !== id))
  // Also remove cell values and dropdown options for this column
  set(KEYS.cells, get<CellValue>(KEYS.cells).filter(cv => cv.column_id !== id))
  set(KEYS.dropdowns, get<DropdownOption>(KEYS.dropdowns).filter(d => d.column_id !== id))
}

// --- Dropdown Options ---
export function getDropdownOptions(columnId?: string): DropdownOption[] {
  const all = get<DropdownOption>(KEYS.dropdowns)
  return columnId ? all.filter(d => d.column_id === columnId).sort((a, b) => a.position - b.position) : all
}
export function saveDropdownOptions(opts: DropdownOption[]) { set(KEYS.dropdowns, opts) }
export function addDropdownOption(columnId: string, value: string, color?: string): DropdownOption {
  const all = getDropdownOptions()
  const colOpts = all.filter(d => d.column_id === columnId)
  const opt: DropdownOption = { id: uuid(), column_id: columnId, value, color, position: colOpts.length }
  all.push(opt)
  saveDropdownOptions(all)
  return opt
}
export function deleteDropdownOption(id: string) {
  saveDropdownOptions(getDropdownOptions().filter(d => d.id !== id))
}

// --- Clients ---
export function getClients(): Client[] {
  return get<Client>(KEYS.clients).filter(c => !c.deleted)
}
export function getAllClients(): Client[] {
  return get<Client>(KEYS.clients)
}
export function saveClients(clients: Client[]) { set(KEYS.clients, clients) }
export function addClient(createdBy: string, assignedTo?: string): Client {
  const clients = getAllClients()
  const client: Client = { id: uuid(), created_at: new Date().toISOString(), created_by: createdBy, updated_at: new Date().toISOString(), assigned_to: assignedTo, deleted: false }
  clients.push(client)
  saveClients(clients)
  return client
}
export function updateClient(id: string, updates: Partial<Client>) {
  const clients = getAllClients().map(c => c.id === id ? { ...c, ...updates, updated_at: new Date().toISOString() } : c)
  saveClients(clients)
}
export function softDeleteClient(id: string) {
  updateClient(id, { deleted: true })
}

// --- Cell Values ---
export function getCellValues(clientId?: string): CellValue[] {
  const all = get<CellValue>(KEYS.cells)
  return clientId ? all.filter(cv => cv.client_id === clientId) : all
}
export function saveCellValues(cells: CellValue[]) { set(KEYS.cells, cells) }
export function setCellValue(clientId: string, columnId: string, value: Partial<CellValue>) {
  const all = getCellValues()
  const idx = all.findIndex(cv => cv.client_id === clientId && cv.column_id === columnId)
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...value }
  } else {
    all.push({ id: uuid(), client_id: clientId, column_id: columnId, ...value } as CellValue)
  }
  saveCellValues(all)
}

// --- Seeded? ---
export function isSeeded(): boolean { return localStorage.getItem(KEYS.seeded) === 'true' }
export function markSeeded() { localStorage.setItem(KEYS.seeded, 'true') }
export function clearAll() {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k))
}
