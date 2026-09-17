import { describe, it, expect } from 'vitest'
import { formatDate, MONTH_NAMES, previousMonth, ddsDeadline, isAfterDdsDeadline } from './utils'

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

describe('ddsDeadline / isAfterDdsDeadline', () => {
  it('срокът е 14-то на месеца СЛЕД работния, краят на деня', () => {
    const d = ddsDeadline(2026, 2) // февруари → 14 март
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(2)   // 0-базиран → март
    expect(d.getDate()).toBe(14)
    expect(d.getHours()).toBe(23)
  })

  it('декември превърта в януари на СЛЕДВАЩАТА година', () => {
    const d = ddsDeadline(2026, 12)
    expect(d.getFullYear()).toBe(2027)
    expect(d.getMonth()).toBe(0)
    expect(d.getDate()).toBe(14)
  })

  it('14-ти до 23:59 НЕ е минал срок — денят е включен', () => {
    expect(isAfterDdsDeadline(2026, 2, new Date(2026, 2, 14, 23, 59, 0))).toBe(false)
  })

  it('15-ти вече е минал срок', () => {
    expect(isAfterDdsDeadline(2026, 2, new Date(2026, 2, 15, 0, 0, 1))).toBe(true)
  })

  it('минал месец си остава заключен', () => {
    expect(isAfterDdsDeadline(2025, 11, new Date(2026, 2, 1))).toBe(true)
  })
})
