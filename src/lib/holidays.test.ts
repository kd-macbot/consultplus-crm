import { describe, it, expect } from 'vitest'
import {
  buildWorkCalendar, isWorkingDay, isoOf, holidayName, holidaysOfYear, EMPTY_CALENDAR,
} from './holidays'
import {
  workingDaysBetween, workingDaysInMonth, workingDaysInMonthTotal, workingDaysInYear,
} from './utils'

// Производственият календар за 2026, сверен срещу kik.info
// (248 работни дни / 1984 часа; и 12-те месеца съвпадат).
const BG2026 = [
  { date: '2026-01-01', name: 'Нова година', is_working: false },
  { date: '2026-01-02', name: 'Разместен неработен ден', is_working: false },
  { date: '2026-03-03', name: 'Ден на Освобождението', is_working: false },
  { date: '2026-04-10', name: 'Разпети петък', is_working: false },
  { date: '2026-04-13', name: 'Светли понеделник', is_working: false },
  { date: '2026-05-01', name: 'Ден на труда', is_working: false },
  { date: '2026-05-06', name: 'Гергьовден', is_working: false },
  { date: '2026-05-25', name: 'Заместващ за 24.05', is_working: false },
  { date: '2026-09-07', name: 'Заместващ за 06.09', is_working: false },
  { date: '2026-09-22', name: 'Ден на Независимостта', is_working: false },
  { date: '2026-12-24', name: 'Бъдни вечер', is_working: false },
  { date: '2026-12-25', name: 'Рождество Христово', is_working: false },
  { date: '2026-12-28', name: 'Заместващ за 26.12', is_working: false },
]
const cal2026 = buildWorkCalendar(BG2026)

describe('isoOf', () => {
  it('дава ЛОКАЛНАТА дата, не UTC', () => {
    // 1 януари 02:00 българско време е 31 декември в UTC — toISOString()
    // би върнал предходния ден и би изместил всеки празник с едно назад.
    expect(isoOf(new Date(2026, 0, 1, 2, 0, 0))).toBe('2026-01-01')
    expect(isoOf(new Date(2026, 11, 31, 23, 59, 0))).toBe('2026-12-31')
  })
})

describe('isWorkingDay', () => {
  it('делник без празник е работен', () => {
    expect(isWorkingDay(new Date(2026, 0, 5), cal2026)).toBe(true)  // понеделник
  })
  it('официалният празник в делник НЕ е работен', () => {
    expect(isWorkingDay(new Date(2026, 0, 1), cal2026)).toBe(false)
  })
  it('разместеният ден (мост) също НЕ е работен', () => {
    expect(isWorkingDay(new Date(2026, 0, 2), cal2026)).toBe(false)
  })
  it('събота и неделя не са работни', () => {
    expect(isWorkingDay(new Date(2026, 0, 3), cal2026)).toBe(false)
    expect(isWorkingDay(new Date(2026, 0, 4), cal2026)).toBe(false)
  })
  it('ОБЯВЕНА работна събота Е работна', () => {
    const cal = buildWorkCalendar([{ date: '2027-01-09', name: 'Отработване', is_working: true }])
    expect(isWorkingDay(new Date(2027, 0, 9), cal)).toBe(true)
  })
  it('без календар остава чистото Пн-Пт', () => {
    expect(isWorkingDay(new Date(2026, 0, 1), EMPTY_CALENDAR)).toBe(true)
  })
})

describe('holidayName', () => {
  it('връща повода, ако има', () => {
    expect(holidayName(new Date(2026, 4, 6), cal2026)).toBe('Гергьовден')
  })
  it('за обикновен ден е празно', () => {
    expect(holidayName(new Date(2026, 4, 7), cal2026)).toBe('')
  })
})

describe('holidaysOfYear', () => {
  it('филтрира по година и подрежда', () => {
    const rows = holidaysOfYear([...BG2026,
      { date: '2027-01-01', name: 'Нова година', is_working: false }], 2026)
    expect(rows).toHaveLength(13)
    expect(rows[0].date).toBe('2026-01-01')
    expect(rows[rows.length - 1].date).toBe('2026-12-28')
  })
})

// ============================================================
// Сверка срещу производствения календар на kik.info за 2026.
// Тези числа са ВЪНШНА истина — ако някой ден се разминем с тях,
// сметката ни е сгрешена, не техните.
// ============================================================
describe('работни дни 2026 срещу производствения календар', () => {
  const KIK = [20, 20, 21, 20, 18, 22, 23, 21, 20, 22, 21, 20]

  it.each(KIK.map((d, i) => [i + 1, d] as const))(
    'месец %i → %i работни дни',
    (month, expected) => {
      expect(workingDaysInMonthTotal(2026, month, cal2026)).toBe(expected)
    },
  )

  it('общо за годината: 248 работни дни (1984 часа)', () => {
    const total = KIK.map((_, i) => workingDaysInMonthTotal(2026, i + 1, cal2026))
      .reduce((a, b) => a + b, 0)
    expect(total).toBe(248)
    expect(total * 8).toBe(1984)
  })

  it('БЕЗ календар излизат 261 — грешката, която поправяме', () => {
    // Всички делници на 2026. Тоест досега системата броеше 13 дни
    // повече от производствения календар — и толкова отпуска отнемаше
    // на колегите, които са почивали по празниците.
    const total = KIK.map((_, i) => workingDaysInMonthTotal(2026, i + 1, EMPTY_CALENDAR))
      .reduce((a, b) => a + b, 0)
    expect(total).toBe(261)
    expect(total - 248).toBe(13)
  })
})

describe('отпуска около празник', () => {
  it('седмица, в която влиза Гергьовден, е 4 използвани дни, не 5', () => {
    // 04.05 (пн) – 08.05 (пт), 06.05 е Гергьовден.
    expect(workingDaysBetween('2026-05-04', '2026-05-08', cal2026)).toBe(4)
    expect(workingDaysBetween('2026-05-04', '2026-05-08', EMPTY_CALENDAR)).toBe(5)
  })

  it('коледната отпуска не яде празничните дни', () => {
    // 21.12 (пн) – 31.12 (чт): празници са 24, 25 и 28.
    expect(workingDaysBetween('2026-12-21', '2026-12-31', cal2026)).toBe(6)
  })

  it('диапазон изцяло в празници е 0 дни', () => {
    expect(workingDaysBetween('2026-01-01', '2026-01-04', cal2026)).toBe(0)
  })

  it('обратен диапазон е 0, не отрицателно число', () => {
    expect(workingDaysBetween('2026-05-08', '2026-05-04', cal2026)).toBe(0)
  })
})

describe('клипване по месец и година', () => {
  it('отпуска през граница на месеца се дели правилно', () => {
    // 28.12.2026 (пн, празник) – 06.01.2027: декември дава 3 (29,30,31).
    expect(workingDaysInMonth('2026-12-28', '2027-01-06', 2026, 12, cal2026)).toBe(3)
  })
  it('в годината влиза само нейната част', () => {
    expect(workingDaysInYear('2026-12-28', '2027-01-06', 2026, cal2026)).toBe(3)
  })
})

// ============================================================
// Законовите празници по изчисление (бутонът „Попълни по закон").
// ============================================================

import { statutoryHolidays, orthodoxEaster } from './holidays'

describe('orthodoxEaster', () => {
  it('известните дати съвпадат', () => {
    const f = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
    expect(f(orthodoxEaster(2024))).toBe('05.05.2024')
    expect(f(orthodoxEaster(2025))).toBe('20.04.2025')
    expect(f(orthodoxEaster(2026))).toBe('12.04.2026')
    expect(f(orthodoxEaster(2027))).toBe('02.05.2027')
    expect(f(orthodoxEaster(2028))).toBe('16.04.2028')
  })

  it('винаги е неделя — иначе сметката е сбъркана', () => {
    for (let y = 2020; y <= 2099; y++) {
      expect(orthodoxEaster(y).getDay()).toBe(0)
    }
  })
})

describe('statutoryHolidays', () => {
  it('2026 дава точно дните от seed-а — без моста на 02.01', () => {
    // Мостът се обявява с решение на МС и НЕ следва от закона.
    // Ако някога се появи тук, значи функцията си измисля.
    expect(statutoryHolidays(2026).map(h => h.date)).toEqual([
      '2026-01-01', '2026-03-03', '2026-04-10', '2026-04-13',
      '2026-05-01', '2026-05-06', '2026-05-25',
      '2026-09-07', '2026-09-22',
      '2026-12-24', '2026-12-25', '2026-12-28',
    ])
  })

  it('2027: 1 май пада в събота И съвпада с Велика събота', () => {
    const dates = statutoryHolidays(2027).map(h => h.date)
    // Светли понеделник заема 03.05, затова заместващият за 1 май
    // отива на първия СВОБОДЕН работен ден — вторник 04.05.
    expect(dates).toContain('2027-05-03')  // Светли понеделник
    expect(dates).toContain('2027-05-04')  // заместващият за 1 май
    const subst = statutoryHolidays(2027).find(h => h.date === '2027-05-04')
    expect(subst?.name).toContain('Ден на труда')
  })

  it('два празника в почивни дни изместват ДВА отделни дни', () => {
    // 2027: 25.12 е събота, 26.12 е неделя → 27 и 28 декември.
    const dates = statutoryHolidays(2027).map(h => h.date)
    expect(dates).toContain('2027-12-27')
    expect(dates).toContain('2027-12-28')
  })

  it('Великденските дни в почивен ден НЕ получават заместващ', () => {
    // Велика събота и Великден винаги падат в почивни дни — изрично
    // изключение в чл. 154, ал. 2. От Великден влизат точно два дни:
    // Разпети петък и Светли понеделник.
    for (const y of [2026, 2027, 2028, 2029, 2030]) {
      const e = orthodoxEaster(y)
      const iso = (d: Date, off: number) => {
        const x = new Date(d); x.setDate(x.getDate() + off)
        return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
      }
      const dates = statutoryHolidays(y).map(h => h.date)
      expect(dates).toContain(iso(e, -2))   // Разпети петък
      expect(dates).toContain(iso(e, 1))    // Светли понеделник
      expect(dates).not.toContain(iso(e, -1))  // Велика събота — почивен
      expect(dates).not.toContain(iso(e, 0))   // Великден — почивен
    }
  })

  it('в списъка НЯМА съботи и недели — те не се вписват', () => {
    for (let y = 2026; y <= 2040; y++) {
      for (const h of statutoryHolidays(y)) {
        const dow = new Date(h.date + 'T00:00:00').getDay()
        expect(dow).not.toBe(0)
        expect(dow).not.toBe(6)
      }
    }
  })

  it('няма повтарящи се дати и всичко е неработно', () => {
    for (let y = 2026; y <= 2040; y++) {
      const rows = statutoryHolidays(y)
      expect(new Set(rows.map(r => r.date)).size).toBe(rows.length)
      expect(rows.every(r => r.is_working === false)).toBe(true)
    }
  })

  it('броят е между 10 и 14 дни — колкото и да мърда календарът', () => {
    for (let y = 2026; y <= 2060; y++) {
      const n = statutoryHolidays(y).length
      expect(n).toBeGreaterThanOrEqual(10)
      expect(n).toBeLessThanOrEqual(14)
    }
  })
})
