import type { Column, ColumnType } from './types'
import { v4 as uuid } from 'uuid'
import * as storage from './storage'
import crmData from '../../crm_data.json'

interface RawRow { [key: string]: string | number | null }

const COLUMN_MAP: { header: string; name: string; type: ColumnType; required: boolean }[] = [
  { header: 'Фирма', name: 'Фирма', type: 'text', required: true },
  { header: 'col_1', name: 'Оценка на клиент', type: 'dropdown', required: false },
  { header: 'СТАТУС', name: 'Статус', type: 'dropdown', required: false },
  { header: 'MAND', name: 'MAND', type: 'text', required: false },
  { header: 'Счетоводител', name: 'Счетоводител', type: 'dropdown', required: false },
  { header: 'Заместване', name: 'Заместване', type: 'dropdown', required: false },
  { header: 'ТРЗ', name: 'ТРЗ', type: 'dropdown', required: false },
  { header: 'ХОНОРАР', name: 'Хонорар', type: 'number', required: false },
  { header: 'ТРЗ Отг.', name: 'ТРЗ Отг.', type: 'dropdown', required: false },
  { header: 'ТРЗ Статус', name: 'ТРЗ Статус', type: 'dropdown', required: false },
  { header: 'Данък изт./СИДО', name: 'Данък изт./СИДО', type: 'dropdown', required: false },
  { header: 'col_11', name: 'Бележки', type: 'text', required: false },
]

export function seedData() {
  if (storage.isSeeded()) return

  const rows: RawRow[] = (crmData as any).Master.data

  // 1. Create columns
  const columns: Column[] = COLUMN_MAP.map((cm, i) => ({
    id: uuid(),
    name: cm.name,
    type: cm.type,
    position: i,
    is_required: cm.required,
    created_by: '1',
    created_at: new Date().toISOString(),
  }))
  storage.saveColumns(columns)

  // 2. Extract & create dropdown options
  const dropdownCols = COLUMN_MAP.filter(cm => cm.type === 'dropdown')
  const allDropdowns: import('./types').DropdownOption[] = []

  for (const dc of dropdownCols) {
    const col = columns.find(c => c.name === dc.name)!
    const uniqueValues = new Set<string>()
    for (const row of rows) {
      const val = row[dc.header]
      if (val != null && String(val).trim()) {
        uniqueValues.add(String(val).trim())
      }
    }
    const sorted = [...uniqueValues].sort()
    sorted.forEach((val, i) => {
      allDropdowns.push({ id: uuid(), column_id: col.id, value: val, position: i })
    })
  }
  storage.saveDropdownOptions(allDropdowns)

  // 3. Create clients and cell values
  const clients: import('./types').Client[] = []
  const cellValues: import('./types').CellValue[] = []

  for (const row of rows) {
    const clientId = uuid()
    const client: import('./types').Client = {
      id: clientId,
      created_at: new Date().toISOString(),
      created_by: '1',
      updated_at: new Date().toISOString(),
      assigned_to: undefined,
      deleted: false,
    }
    clients.push(client)

    for (const cm of COLUMN_MAP) {
      const col = columns.find(c => c.name === cm.name)!
      const rawVal = row[cm.header]
      if (rawVal == null || String(rawVal).trim() === '') continue

      const cell: import('./types').CellValue = {
        id: uuid(),
        client_id: clientId,
        column_id: col.id,
      }

      if (cm.type === 'number') {
        cell.value_number = Number(rawVal) || 0
      } else if (cm.type === 'dropdown') {
        const opt = allDropdowns.find(d => d.column_id === col.id && d.value === String(rawVal).trim())
        if (opt) cell.value_dropdown = opt.id
      } else {
        cell.value_text = String(rawVal).trim()
      }

      cellValues.push(cell)
    }
  }

  storage.saveClients(clients)
  storage.saveCellValues(cellValues)
  storage.markSeeded()
}
