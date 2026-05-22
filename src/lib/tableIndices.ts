// O(1) индекси за горещите lookup-и в големите таблици.
//
// Преди: cells.find(cv => cv.client_id === X && cv.column_id === Y) → O(N)
//        вътре в render loop = O(N × M) на render.
//
// Сега:  cellIndex.get(cellKey(X, Y)) → O(1).
// При 200 клиента × 30 колони → ~6000× по-малко работа на render.

import type { CellValue, Column, DropdownOption } from './types'

export function cellKey(clientId: string, columnId: string): string {
  return `${clientId}|${columnId}`
}

/** Map ключ = "clientId|columnId" → CellValue */
export function buildCellIndex(cells: CellValue[]): Map<string, CellValue> {
  const map = new Map<string, CellValue>()
  for (const cv of cells) map.set(cellKey(cv.client_id, cv.column_id), cv)
  return map
}

/** Map ключ = dropdown_option.id → DropdownOption */
export function buildDropdownIndex(dropdowns: DropdownOption[]): Map<string, DropdownOption> {
  const map = new Map<string, DropdownOption>()
  for (const d of dropdowns) map.set(d.id, d)
  return map
}

/** Map ключ = column.name → Column (за намиране на мастер колони по име) */
export function buildColumnByName(columns: Column[]): Map<string, Column> {
  const map = new Map<string, Column>()
  for (const c of columns) map.set(c.name, c)
  return map
}

/**
 * Връща dropdown стойността (текст) за дадена клетка с тип dropdown.
 * Връща празен низ ако клетката не съществува или dropdown опцията липсва.
 */
export function resolveDropdownText(
  clientId: string,
  column: Column | undefined,
  cellIdx: Map<string, CellValue>,
  dropdownIdx: Map<string, DropdownOption>,
): string {
  if (!column) return ''
  const cell = cellIdx.get(cellKey(clientId, column.id))
  if (!cell?.value_dropdown) return ''
  return dropdownIdx.get(cell.value_dropdown)?.value ?? ''
}

/**
 * Връща текстовата стойност на клетка независимо от типа:
 * - dropdown: ако е staff-свързана (стойност във value_text) → него; иначе
 *   резолва option id-то през dropdownIdx.
 * - друго: value_text.
 * Празно ако клетката липсва.
 */
export function resolveCellText(
  clientId: string,
  column: Column | undefined,
  cellIdx: Map<string, CellValue>,
  dropdownIdx: Map<string, DropdownOption>,
): string {
  if (!column) return ''
  const cell = cellIdx.get(cellKey(clientId, column.id))
  if (!cell) return ''
  if (column.type === 'dropdown') {
    if (cell.value_text) return cell.value_text
    if (cell.value_dropdown) return dropdownIdx.get(cell.value_dropdown)?.value ?? ''
    return ''
  }
  return cell.value_text ?? ''
}

/** Връща стойността на text клетка (или празен низ). */
export function resolveText(
  clientId: string,
  column: Column | undefined,
  cellIdx: Map<string, CellValue>,
): string {
  if (!column) return ''
  return cellIdx.get(cellKey(clientId, column.id))?.value_text ?? ''
}

/** Връща стойността на number клетка (или null). */
export function resolveNumber(
  clientId: string,
  column: Column | undefined,
  cellIdx: Map<string, CellValue>,
): number | null {
  if (!column) return null
  return cellIdx.get(cellKey(clientId, column.id))?.value_number ?? null
}

/**
 * Намира името на клиента (първата text колона с непразна стойност).
 * Очаква columns подадени в реда им от crm_columns (по position).
 */
export function clientDisplayName(
  clientId: string,
  columns: Column[],
  cellIdx: Map<string, CellValue>,
): string {
  for (const col of columns) {
    if (col.type !== 'text') continue
    const v = cellIdx.get(cellKey(clientId, col.id))?.value_text
    if (v) return v
  }
  return ''
}
