import { getColumns, getClients, getCellValues, getDropdownOptions } from './storage'
import { buildCellIndex, buildDropdownIndex, cellKey } from './tableIndices'

export async function exportToExcel() {
  // Динамичен import — xlsx (~400 KB) се сваля чак при реален експорт,
  // а не при всяко отваряне на Клиенти.
  const XLSX = await import('xlsx')

  const [columns, clients, cells, dropdowns] = await Promise.all([
    getColumns(), getClients(), getCellValues(), getDropdownOptions()
  ])

  const cellIdx = buildCellIndex(cells)
  const dropdownIdx = buildDropdownIndex(dropdowns)

  const headers = columns.map(c => c.name)
  const rows = clients.map(client => {
    return columns.map(col => {
      const cell = cellIdx.get(cellKey(client.id, col.id))
      if (!cell) return ''
      if (col.type === 'number') return cell.value_number ?? ''
      if (col.type === 'dropdown') {
        if (col.staff_department) return cell.value_text ?? ''
        return dropdownIdx.get(cell.value_dropdown ?? '')?.value ?? ''
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

/** Общ Excel експорт от готови заглавия + редове (AOA). */
export async function exportRowsToExcel(opts: {
  headers: string[]
  rows: (string | number)[][]
  sheetName: string
  fileName: string
}) {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet([opts.headers, ...opts.rows])
  ws['!cols'] = opts.headers.map((h, i) => {
    const maxLen = Math.max(h.length, ...opts.rows.map(r => String(r[i] ?? '').length))
    return { wch: Math.min(maxLen + 2, 40) }
  })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, opts.sheetName)
  XLSX.writeFile(wb, opts.fileName)
}
