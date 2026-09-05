import { describe, it, expect } from 'vitest'
import { lastWorkMonths, orDash, vatDisplay, doneCount, lastClosedQuarter, romanQuarter } from './clientCard'

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

describe('lastClosedQuarter', () => {
  it('март → I тримесечие е завършило, месеци 1-3', () => {
    expect(lastClosedQuarter({ year: 2026, month: 3 })).toEqual({
      year: 2026, quarter: 1, months: [1, 2, 3],
    })
  })

  it('май → още е I тримесечие (II свършва чак през юни)', () => {
    const r = lastClosedQuarter({ year: 2026, month: 5 })
    expect(r.quarter).toBe(1)
    expect(r.months).toEqual([1, 2, 3])
  })

  it('декември → IV тримесечие, цялата година', () => {
    const r = lastClosedQuarter({ year: 2026, month: 12 })
    expect(r.quarter).toBe(4)
    expect(r.months).toHaveLength(12)
  })

  it('януари и февруари → нищо не е завършило, взима се ЦЯЛАТА предходна година', () => {
    for (const m of [1, 2]) {
      const r = lastClosedQuarter({ year: 2026, month: m })
      expect(r).toEqual({ year: 2025, quarter: 4, months: [1,2,3,4,5,6,7,8,9,10,11,12] })
    }
  })

  it('юни → II тримесечие, месеци 1-6', () => {
    const r = lastClosedQuarter({ year: 2026, month: 6 })
    expect(r.quarter).toBe(2)
    expect(r.months).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('romanQuarter', () => {
  it('римски номера', () => {
    expect(romanQuarter(1)).toBe('I')
    expect(romanQuarter(4)).toBe('IV')
  })
})
