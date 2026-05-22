import { describe, it, expect } from 'vitest'
import type { Column, ColumnType, CellValue, DropdownOption } from './types'
import {
  buildCellIndex, buildDropdownIndex, cellKey,
  resolveDropdownText, resolveCellText, resolveNumber, clientDisplayName,
} from './tableIndices'

function col(id: string, name: string, type: ColumnType): Column {
  return { id, name, type, position: 0, is_required: false, created_by: '', created_at: '' }
}
function cell(client_id: string, column_id: string, v: Partial<CellValue>): CellValue {
  return { id: `${client_id}-${column_id}`, client_id, column_id, ...v }
}
function opt(id: string, column_id: string, value: string): DropdownOption {
  return { id, column_id, value, position: 0 }
}

describe('buildCellIndex / cellKey', () => {
  it('индексира по client|column', () => {
    const idx = buildCellIndex([cell('c1', 'col1', { value_text: 'X' })])
    expect(idx.get(cellKey('c1', 'col1'))?.value_text).toBe('X')
    expect(idx.get(cellKey('c1', 'nope'))).toBeUndefined()
  })
})

describe('resolveDropdownText', () => {
  const dd = col('s', 'Статус', 'dropdown')
  const dropdownIdx = buildDropdownIndex([opt('o1', 's', 'АКТИВНА')])
  it('резолва option id → стойност', () => {
    const cellIdx = buildCellIndex([cell('c1', 's', { value_dropdown: 'o1' })])
    expect(resolveDropdownText('c1', dd, cellIdx, dropdownIdx)).toBe('АКТИВНА')
  })
  it('липсваща клетка / колона → празно', () => {
    expect(resolveDropdownText('c1', dd, buildCellIndex([]), dropdownIdx)).toBe('')
    expect(resolveDropdownText('c1', undefined, buildCellIndex([]), dropdownIdx)).toBe('')
  })
})

describe('resolveCellText', () => {
  const dropCol = col('d', 'Софтуер', 'dropdown')
  const staffCol = col('st', 'ТРЗ', 'dropdown')
  const textCol = col('t', 'Бележка', 'text')
  const dropdownIdx = buildDropdownIndex([opt('o1', 'd', 'ОМЕКС')])

  it('обикновен dropdown → резолва през option id', () => {
    const idx = buildCellIndex([cell('c1', 'd', { value_dropdown: 'o1' })])
    expect(resolveCellText('c1', dropCol, idx, dropdownIdx)).toBe('ОМЕКС')
  })
  it('staff-свързан dropdown → чете value_text', () => {
    const idx = buildCellIndex([cell('c1', 'st', { value_text: 'Иван Иванов' })])
    expect(resolveCellText('c1', staffCol, idx, dropdownIdx)).toBe('Иван Иванов')
  })
  it('text колона → value_text', () => {
    const idx = buildCellIndex([cell('c1', 't', { value_text: 'бел.' })])
    expect(resolveCellText('c1', textCol, idx, dropdownIdx)).toBe('бел.')
  })
  it('липсваща клетка → празно', () => {
    expect(resolveCellText('c1', textCol, buildCellIndex([]), dropdownIdx)).toBe('')
  })
})

describe('resolveNumber', () => {
  const numCol = col('h', 'Хонорар', 'number')
  it('връща числото или null', () => {
    const idx = buildCellIndex([cell('c1', 'h', { value_number: 250 })])
    expect(resolveNumber('c1', numCol, idx)).toBe(250)
    expect(resolveNumber('c2', numCol, idx)).toBeNull()
  })
})

describe('clientDisplayName', () => {
  it('първата text колона с непразна стойност', () => {
    const cols = [col('name', 'Фирма', 'text'), col('note', 'Бележка', 'text')]
    const idx = buildCellIndex([cell('c1', 'name', { value_text: 'Акме ООД' })])
    expect(clientDisplayName('c1', cols, idx)).toBe('Акме ООД')
  })
  it('няма стойност → празно', () => {
    expect(clientDisplayName('c1', [col('name', 'Фирма', 'text')], buildCellIndex([]))).toBe('')
  })
})
