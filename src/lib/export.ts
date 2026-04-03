import * as XLSX from 'xlsx'
import { getColumns, getClients, getCellValues, getDropdownOptions } from './storage'
import type { Column, CellValue, DropdownOption } from './types'

export async function exportToExcel() {
  const [columns, clients, cells, dropdowns] = await Promise.all([
    getColumns(), getClients(), getCellValues(), getDropdownOptions()
  ])

  const headers = columns.map(c => c.name)
  const rows = clients.map(client => {
    const clientCells = cells.filter(cv => cv.client_id === client.id)
    return columns.map(col => {
      const cell = clientCells.find(cv => cv.column_id === col.id)
      if (!cell) return ''
      if (col.type === 'number') return cell.value_number ?? ''
      if (col.type === 'dropdown') {
        if (col.staff_department) return cell.value_text ?? ''
        const opt = dropdowns.find(d => d.id === cell.value_dropdown)
        return opt?.value ?? ''
      }
      if (col.type === 'checkbox') return cell.value_bool ? 'Да' : 'Не'
      if (col.type === 'date') return cell.value_date ?? ''
      return cell.value_text ?? ''
    })
  })

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])

  // Auto-width columns
  ws['!cols'] = headers.map((h, i) => {
    const maxLen = Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length))
    return { wch: Math.min(maxLen + 2, 40) }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Клиенти')

  const date = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `ConsultPlus_Клиенти_${date}.xlsx`)
}
