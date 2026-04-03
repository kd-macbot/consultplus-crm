import * as XLSX from 'xlsx'
import type { Column, CellValue, DropdownOption } from './types'
import {
  getColumns, getClients, getCellValues, getDropdownOptions,
  addClient, setCellValue, addDropdownOption, getStaff,
} from './storage'

export interface ParsedSheet {
  headers: string[]
  rows: string[][]  // all rows as strings
}

export interface ColumnMapping {
  excelIndex: number       // index in parsed headers
  excelHeader: string
  crmColumn: Column | null // mapped CRM column, null = skip
}

export interface ImportResult {
  imported: number
  updated: number
  skipped: number
  errors: { row: number; message: string }[]
}

// ── Parse file ──────────────────────────────────────────────

export function parseFile(file: File): Promise<ParsedSheet> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        if (raw.length < 2) {
          reject(new Error('Файлът е празен или няма данни след заглавния ред.'))
          return
        }
        const headers = raw[0].map(h => String(h).trim())
        const rows = raw.slice(1).filter(r => r.some(c => String(c).trim() !== ''))
        resolve({ headers, rows: rows.map(r => r.map(c => String(c).trim())) })
      } catch {
        reject(new Error('Неуспешно четене на файла. Проверете формата.'))
      }
    }
    reader.onerror = () => reject(new Error('Грешка при четене на файла.'))
    reader.readAsArrayBuffer(file)
  })
}

// ── Auto-map columns (fuzzy) ────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '')
}

export function autoMapColumns(excelHeaders: string[], crmColumns: Column[]): ColumnMapping[] {
  const usedCrm = new Set<string>()
  return excelHeaders.map((header, i) => {
    const norm = normalize(header)
    // exact normalized match first
    let match = crmColumns.find(c => !usedCrm.has(c.id) && normalize(c.name) === norm)
    // substring match
    if (!match) {
      match = crmColumns.find(c =>
        !usedCrm.has(c.id) && (normalize(c.name).includes(norm) || norm.includes(normalize(c.name)))
      )
    }
    if (match) usedCrm.add(match.id)
    return { excelIndex: i, excelHeader: header, crmColumn: match ?? null }
  })
}

// ── Parse cell values ───────────────────────────────────────

function parseNumber(raw: string): number | null {
  if (!raw) return null
  // Bulgarian: '1 234,56' → 1234.56  or standard '1234.56'
  let s = raw.replace(/\s/g, '')
  // If comma is decimal separator (and no dot, or dot is thousands)
  if (s.includes(',') && !s.includes('.')) {
    s = s.replace(',', '.')
  } else if (s.includes(',') && s.includes('.')) {
    // 1.234,56 → 1234.56
    s = s.replace(/\./g, '').replace(',', '.')
  }
  const n = Number(s)
  return isNaN(n) ? null : n
}

function parseBool(raw: string): boolean {
  const v = raw.toLowerCase().trim()
  return v === 'да' || v === 'true' || v === '1' || v === 'yes'
}

function parseDate(raw: string): string | null {
  if (!raw) return null
  // DD.MM.YYYY
  let m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  // DD/MM/YYYY
  m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  // YYYY-MM-DD already
  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  // Excel serial date number
  const num = Number(raw)
  if (!isNaN(num) && num > 30000 && num < 60000) {
    const d = new Date((num - 25569) * 86400 * 1000)
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10)
    }
  }
  return null
}

// ── Import rows ─────────────────────────────────────────────

export async function importRows(
  rows: string[][],
  mappings: ColumnMapping[],
  duplicateAction: 'update' | 'skip',
  onNewDropdownOptions: (options: { columnName: string; values: string[] }[]) => Promise<boolean>,
  userId?: string,
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, updated: 0, skipped: 0, errors: [] }

  // Load current state
  const [columns, existingClients, existingCells, dropdownOpts] = await Promise.all([
    getColumns(), getClients(), getCellValues(), getDropdownOptions(),
  ])

  // Find the "Фирма" column for duplicate detection
  const firmaMapping = mappings.find(m => m.crmColumn && normalize(m.crmColumn.name) === normalize('Фирма'))
  const firmaColumn = firmaMapping?.crmColumn
  const firmaMap = new Map<string, string>() // normalized firma → client id
  if (firmaColumn) {
    for (const cell of existingCells) {
      if (cell.column_id === firmaColumn.id && cell.value_text) {
        firmaMap.set(normalize(cell.value_text), cell.client_id)
      }
    }
  }

  // Build dropdown lookup: column_id → Map<normalizedValue, optionId>
  const dropdownLookup = new Map<string, Map<string, string>>()
  for (const opt of dropdownOpts) {
    if (!dropdownLookup.has(opt.column_id)) dropdownLookup.set(opt.column_id, new Map())
    dropdownLookup.get(opt.column_id)!.set(normalize(opt.value), opt.id)
  }

  // Load staff for staff_department columns
  const staffCache = new Map<string, Map<string, string>>() // dept → Map<normalizedName, staffId>
  const staffDeptColumns = mappings
    .filter(m => m.crmColumn?.staff_department)
    .map(m => m.crmColumn!)
  for (const col of staffDeptColumns) {
    if (!staffCache.has(col.staff_department!)) {
      const staff = await getStaff(col.staff_department!)
      const map = new Map<string, string>()
      for (const s of staff) map.set(normalize(s.full_name), s.id)
      staffCache.set(col.staff_department!, map)
    }
  }

  // Collect new dropdown values that need creation
  const newDropdownValues = new Map<string, Set<string>>() // columnId → set of raw values
  for (const [rowIdx, row] of rows.entries()) {
    for (const mapping of mappings) {
      if (!mapping.crmColumn) continue
      const col = mapping.crmColumn
      if (col.type !== 'dropdown' || col.staff_department) continue
      const raw = row[mapping.excelIndex] ?? ''
      if (!raw) continue
      const colLookup = dropdownLookup.get(col.id)
      if (!colLookup?.has(normalize(raw))) {
        if (!newDropdownValues.has(col.id)) newDropdownValues.set(col.id, new Set())
        newDropdownValues.get(col.id)!.add(raw)
      }
    }
  }

  // Ask user to confirm new dropdown options
  if (newDropdownValues.size > 0) {
    const toConfirm: { columnName: string; values: string[] }[] = []
    for (const [colId, vals] of newDropdownValues) {
      const col = columns.find(c => c.id === colId)
      toConfirm.push({ columnName: col?.name ?? colId, values: [...vals] })
    }
    const confirmed = await onNewDropdownOptions(toConfirm)
    if (!confirmed) {
      return result // user cancelled
    }
    // Create the new options
    for (const [colId, vals] of newDropdownValues) {
      for (const val of vals) {
        const opt = await addDropdownOption(colId, val)
        if (!dropdownLookup.has(colId)) dropdownLookup.set(colId, new Map())
        dropdownLookup.get(colId)!.set(normalize(val), opt.id)
      }
    }
  }

  // Import each row
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx]
    try {
      // Check for duplicate
      let clientId: string | null = null
      let isExisting = false
      if (firmaMapping && firmaColumn) {
        const firmaVal = row[firmaMapping.excelIndex] ?? ''
        if (firmaVal) {
          const existing = firmaMap.get(normalize(firmaVal))
          if (existing) {
            if (duplicateAction === 'skip') {
              result.skipped++
              continue
            }
            clientId = existing
            isExisting = true
          }
        }
      }

      // Create new client if not existing
      if (!clientId) {
        const client = await addClient(userId)
        clientId = client.id
      }

      // Set cell values
      for (const mapping of mappings) {
        if (!mapping.crmColumn) continue
        const col = mapping.crmColumn
        const raw = row[mapping.excelIndex] ?? ''
        if (!raw && !isExisting) continue // skip empty cells for new clients

        const cellValue: Partial<CellValue> = {}

        switch (col.type) {
          case 'text':
          case 'email':
          case 'phone':
            cellValue.value_text = raw || undefined
            break

          case 'number': {
            const num = parseNumber(raw)
            if (num !== null) cellValue.value_number = num
            else if (raw) {
              result.errors.push({ row: rowIdx + 2, message: `Невалидно число "${raw}" за колона "${col.name}"` })
              continue
            }
            break
          }

          case 'date': {
            const d = parseDate(raw)
            if (d) cellValue.value_date = d
            else if (raw) {
              result.errors.push({ row: rowIdx + 2, message: `Невалидна дата "${raw}" за колона "${col.name}"` })
              continue
            }
            break
          }

          case 'checkbox':
            cellValue.value_bool = parseBool(raw)
            break

          case 'dropdown': {
            if (col.staff_department) {
              // Staff dropdown — match by name, store as value_text
              const staffMap = staffCache.get(col.staff_department!)
              const match = staffMap?.get(normalize(raw))
              if (match) {
                cellValue.value_text = raw
                cellValue.value_dropdown = match
              } else if (raw) {
                result.errors.push({ row: rowIdx + 2, message: `Служител "${raw}" не е намерен за колона "${col.name}"` })
                continue
              }
            } else {
              // Regular dropdown
              const optId = dropdownLookup.get(col.id)?.get(normalize(raw))
              if (optId) cellValue.value_dropdown = optId
              else if (raw) {
                result.errors.push({ row: rowIdx + 2, message: `Стойност "${raw}" не е намерена за колона "${col.name}"` })
                continue
              }
            }
            break
          }
        }

        if (Object.keys(cellValue).length > 0) {
          await setCellValue(clientId, col.id, cellValue)
        }
      }

      if (isExisting) result.updated++
      else result.imported++
    } catch (err: any) {
      result.errors.push({ row: rowIdx + 2, message: err?.message ?? 'Неизвестна грешка' })
    }
  }

  return result
}
