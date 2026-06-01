import { describe, it, expect } from 'vitest'
import { formatDate, MONTH_NAMES, previousMonth } from './utils'

describe('formatDate', () => {
  it('ISO → DD.MM.YYYY', () => {
    expect(formatDate('2026-05-22')).toBe('22.05.2026')
    expect(formatDate('2026-05-22T10:30:00Z')).toBe('22.05.2026')
  })
  it('празно/null/undefined → празен низ', () => {
    expect(formatDate('')).toBe('')
    expect(formatDate(null)).toBe('')
    expect(formatDate(undefined)).toBe('')
  })
  it('невалиден формат → връща входа', () => {
    expect(formatDate('22.05.2026')).toBe('22.05.2026')
  })
})

describe('MONTH_NAMES', () => {
  it('12 месеца, започва с Януари', () => {
    expect(MONTH_NAMES).toHaveLength(12)
    expect(MONTH_NAMES[0]).toBe('Януари')
    expect(MONTH_NAMES[11]).toBe('Декември')
  })
})

describe('previousMonth', () => {
  it('юни → май на същата година', () => {
    expect(previousMonth(new Date(2026, 5, 15))).toEqual({ year: 2026, month: 5 })
  })
  it('януари → декември на предходната година', () => {
    expect(previousMonth(new Date(2026, 0, 10))).toEqual({ year: 2025, month: 12 })
  })
  it('декември → ноември', () => {
    expect(previousMonth(new Date(2026, 11, 31))).toEqual({ year: 2026, month: 11 })
  })
})
