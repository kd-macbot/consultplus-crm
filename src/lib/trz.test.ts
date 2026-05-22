import { describe, it, expect } from 'vitest'
import type { Column, ColumnType, TrzWork } from './types'
import { findTrzColumns, computeTrzProgress } from './trz'

function col(name: string, type: ColumnType = 'dropdown', extra: Partial<Column> = {}): Column {
  return { id: name, name, type, position: 0, is_required: false, created_by: '', created_at: '', ...extra }
}

function work(id: string, p: Partial<TrzWork> = {}): TrzWork {
  return {
    id, client_id: id, year: 2026, month: 5,
    salaries_prepared: false, insurance_submitted: false, insurance_submitted_at: null,
    payroll_sent: false, payroll_sent_at: null, notes: null,
    created_at: '', created_by: null, updated_at: '', ...p,
  }
}

describe('findTrzColumns', () => {
  it('разпознава четирите колони по име', () => {
    const cols = [
      col('Фирма', 'text'),
      col('ТРЗ Статус'),
      col('Форма на Осиг.'),
      col('ТРЗ'),
      col('ТРЗ Софтуер'),
    ]
    const r = findTrzColumns(cols)
    expect(r.status?.name).toBe('ТРЗ Статус')
    expect(r.forma?.name).toBe('Форма на Осиг.')
    expect(r.resp?.name).toBe('ТРЗ')
    expect(r.software?.name).toBe('ТРЗ Софтуер')
  })

  it('resp не хваща „ТРЗ Статус" нито „ТРЗ Софтуер"', () => {
    const cols = [col('ТРЗ Статус'), col('ТРЗ Софтуер')]
    expect(findTrzColumns(cols).resp).toBeUndefined()
  })

  it('липсващи колони → undefined', () => {
    const r = findTrzColumns([col('Фирма', 'text')])
    expect(r.status).toBeUndefined()
    expect(r.forma).toBeUndefined()
    expect(r.resp).toBeUndefined()
    expect(r.software).toBeUndefined()
  })

  it('нечувствително към регистър', () => {
    expect(findTrzColumns([col('трз статус')]).status?.name).toBe('трз статус')
  })
})

describe('computeTrzProgress', () => {
  it('брои само подадените активни id-та', () => {
    const byClient = new Map<string, TrzWork>([
      ['a', work('a', { salaries_prepared: true, insurance_submitted: true, payroll_sent: true })],
      ['b', work('b', { salaries_prepared: true })],
      ['c', work('c')],
    ])
    const r = computeTrzProgress(['a', 'b', 'c'], byClient)
    expect(r).toEqual({ total: 3, salaries: 2, insurance: 1, payroll: 1, fullyDone: 1 })
  })

  it('клиент без ред не се брои, но влиза в total', () => {
    const byClient = new Map<string, TrzWork>([['a', work('a', { salaries_prepared: true })]])
    const r = computeTrzProgress(['a', 'b'], byClient)
    expect(r.total).toBe(2)
    expect(r.salaries).toBe(1)
    expect(r.fullyDone).toBe(0)
  })

  it('празен списък → нули', () => {
    expect(computeTrzProgress([], new Map())).toEqual({ total: 0, salaries: 0, insurance: 0, payroll: 0, fullyDone: 0 })
  })
})
