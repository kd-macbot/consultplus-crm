import { describe, it, expect } from 'vitest'
import { lastWorkMonths, orDash, vatDisplay, doneCount } from './clientCard'

describe('lastWorkMonths', () => {
  it('започва от РАБОТНИЯ месец (предходния), не от текущия', () => {
    // 15 март 2026 → работният е февруари.
    expect(lastWorkMonths(new Date(2026, 2, 15), 3)).toEqual([
      { year: 2026, month: 2 },
      { year: 2026, month: 1 },
      { year: 2025, month: 12 },
    ])
  })

  it('минава коректно през началото на годината', () => {
    // Януари 2026 → работният е декември 2025.
    expect(lastWorkMonths(new Date(2026, 0, 5), 3)).toEqual([
      { year: 2025, month: 12 },
      { year: 2025, month: 11 },
      { year: 2025, month: 10 },
    ])
  })

  it('брои толкова месеца, колкото са поискани', () => {
    expect(lastWorkMonths(new Date(2026, 5, 1), 1)).toHaveLength(1)
    expect(lastWorkMonths(new Date(2026, 5, 1), 6)).toHaveLength(6)
  })
})

describe('orDash', () => {
  it('празното и само интервалите стават тире', () => {
    expect(orDash(null)).toBe('—')
    expect(orDash('   ')).toBe('—')
  })

  it('стойността се пази както е', () => {
    expect(orDash('123456789')).toBe('123456789')
  })
})

describe('vatDisplay', () => {
  it('готовият ДДС номер се показва както е', () => {
    expect(vatDisplay('BG123456789', '123456789', '2020-01-01')).toBe('BG123456789')
  })

  it('без ДДС номер, но с дата на регистрация → BG + ЕИК', () => {
    expect(vatDisplay(null, '123456789', '2020-01-01')).toBe('BG123456789')
  })

  it('БЕЗ дата на регистрация не се твърди регистрация', () => {
    expect(vatDisplay(null, '123456789', null)).toBe('—')
    expect(vatDisplay(null, '123456789', '  ')).toBe('—')
  })

  it('без ЕИК няма какво да се сглоби', () => {
    expect(vatDisplay(null, null, '2020-01-01')).toBe('—')
  })
})

describe('doneCount', () => {
  it('брои само отметнатите', () => {
    expect(doneCount([true, false, true, null, undefined])).toEqual({ done: 2, total: 5 })
  })

  it('празен списък е 0 от 0, не дели на нула', () => {
    expect(doneCount([])).toEqual({ done: 0, total: 0 })
  })
})
