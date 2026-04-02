import type { ColumnType } from './types'
import { supabase } from './supabase'
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

export async function seedData() {
  // Check if already seeded
  const { count } = await supabase.from('crm_columns').select('*', { count: 'exact', head: true })
  if ((count ?? 0) > 0) return

  console.log('Seeding CRM data...')
  const rows: RawRow[] = (crmData as any).Master.data

  // 1. Create columns
  const colInserts = COLUMN_MAP.map((cm, i) => ({
    name: cm.name,
    type: cm.type,
    position: i,
    is_required: cm.required,
  }))
  const { data: columns, error: colErr } = await supabase
    .from('crm_columns')
    .insert(colInserts)
    .select()
  if (colErr) { console.error('Column seed error:', colErr); return }

  // 2. Extract & create dropdown options
  const dropdownCols = COLUMN_MAP.filter(cm => cm.type === 'dropdown')
  const allDropdowns: { column_id: string; value: string; position: number }[] = []

  for (const dc of dropdownCols) {
    const col = columns!.find(c => c.name === dc.name)!
    const uniqueValues = new Set<string>()
    for (const row of rows) {
      const val = row[dc.header]
      if (val != null && String(val).trim()) {
        uniqueValues.add(String(val).trim())
      }
    }
    const sorted = [...uniqueValues].sort()
    sorted.forEach((val, i) => {
      allDropdowns.push({ column_id: col.id, value: val, position: i })
    })
  }

  let insertedDropdowns: any[] = []
  if (allDropdowns.length > 0) {
    const { data: dd, error: ddErr } = await supabase
      .from('crm_dropdown_options')
      .insert(allDropdowns)
      .select()
    if (ddErr) { console.error('Dropdown seed error:', ddErr); return }
    insertedDropdowns = dd ?? []
  }

  // 3. Create clients in batches
  const clientInserts = rows.map(() => ({}))
  // Supabase batch limit: insert in chunks of 50
  const BATCH = 50
  let allInsertedClients: any[] = []
  for (let i = 0; i < clientInserts.length; i += BATCH) {
    const batch = clientInserts.slice(i, i + BATCH)
    const { data: clients, error: clientErr } = await supabase
      .from('crm_clients')
      .insert(batch)
      .select()
    if (clientErr) { console.error('Client seed error:', clientErr); return }
    allInsertedClients = allInsertedClients.concat(clients ?? [])
  }

  // 4. Create cell values
  const cellInserts: any[] = []
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri]
    const clientId = allInsertedClients[ri].id

    for (const cm of COLUMN_MAP) {
      const col = columns!.find(c => c.name === cm.name)!
      const rawVal = row[cm.header]
      if (rawVal == null || String(rawVal).trim() === '') continue

      const cell: any = { client_id: clientId, column_id: col.id }

      if (cm.type === 'number') {
        cell.value_number = Number(rawVal) || 0
      } else if (cm.type === 'dropdown') {
        const opt = insertedDropdowns.find((d: any) => d.column_id === col.id && d.value === String(rawVal).trim())
        if (opt) cell.value_dropdown = opt.id
      } else {
        cell.value_text = String(rawVal).trim()
      }

      cellInserts.push(cell)
    }
  }

  // Insert cells in batches
  for (let i = 0; i < cellInserts.length; i += BATCH) {
    const batch = cellInserts.slice(i, i + BATCH)
    const { error: cellErr } = await supabase.from('crm_cell_values').insert(batch)
    if (cellErr) { console.error('Cell seed error at batch', i, cellErr); return }
  }

  console.log(`Seeded: ${columns!.length} columns, ${insertedDropdowns.length} dropdown options, ${allInsertedClients.length} clients, ${cellInserts.length} cell values`)
}
