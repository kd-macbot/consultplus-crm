import { describe, it, expect } from 'vitest'
import {
  daysLeft, clientCertStatus, expiryLabel, noticeDueToday, certsForNotice,
  sortByUrgency, countByStatus,
} from './clientCertificates'

const TODAY = '2026-10-13'
const cert = (id: string, holder: string, valid_to: string | null, client_id: string | null = null) =>
  ({ id, holder, valid_to, client_id })

describe('daysLeft', () => {
  it('брои дните до изтичане', () => {
    expect(daysLeft('2026-10-20', TODAY)).toBe(7)
    expect(daysLeft('2026-10-13', TODAY)).toBe(0)
    expect(daysLeft('2026-10-10', TODAY)).toBe(-3)
  })
  it('липсваща или нечетима дата дава null', () => {
    expect(daysLeft(null, TODAY)).toBeNull()
    expect(daysLeft('', TODAY)).toBeNull()
    expect(daysLeft('не е дата', TODAY)).toBeNull()
  })
  it('не се подвежда от смяната на лятното време', () => {
    // 25.10.2026 е неделята, в която часовникът се връща.
    expect(daysLeft('2026-10-26', '2026-10-24')).toBe(2)
  })
})

describe('clientCertStatus', () => {
  it('различава четирите състояния', () => {
    expect(clientCertStatus('2027-01-01', TODAY)).toBe('valid')
    expect(clientCertStatus('2026-11-01', TODAY)).toBe('expiring')
    expect(clientCertStatus('2026-10-01', TODAY)).toBe('expired')
    expect(clientCertStatus(null, TODAY)).toBe('unknown')
  })
  it('днешният ден още НЕ е изтекъл', () => {
    // Подписът важи до края на деня — „изтекъл" от сутринта би подвело.
    expect(clientCertStatus(TODAY, TODAY)).toBe('expiring')
  })
  it('границата от 30 дни влиза в „изтича скоро"', () => {
    expect(clientCertStatus('2026-11-12', TODAY)).toBe('expiring')
    expect(clientCertStatus('2026-11-13', TODAY)).toBe('valid')
  })
})

describe('expiryLabel', () => {
  it('говори на човешки', () => {
    expect(expiryLabel(12)).toBe('след 12 дни')
    expect(expiryLabel(1)).toBe('изтича утре')
    expect(expiryLabel(0)).toBe('изтича ДНЕС')
    expect(expiryLabel(-1)).toBe('изтекъл вчера')
    expect(expiryLabel(-5)).toBe('изтекъл преди 5 дни')
    expect(expiryLabel(null)).toBe('без дата')
  })
})

describe('noticeDueToday', () => {
  const T = [30, 20, 7]

  it('пада точно на прага', () => {
    expect(noticeDueToday('2026-11-12', TODAY, T)).toBe(true)   // 30
    expect(noticeDueToday('2026-11-02', TODAY, T)).toBe(true)   // 20
    expect(noticeDueToday('2026-10-20', TODAY, T)).toBe(true)   // 7
  })

  it('МЕЖДУ праговете мълчи', () => {
    // Точно това пази писмото да не идва всеки ден цял месец.
    expect(noticeDueToday('2026-11-07', TODAY, T)).toBe(false)  // 25
    expect(noticeDueToday('2026-10-23', TODAY, T)).toBe(false)  // 10
  })

  it('изтекъл подпис не праща пак', () => {
    expect(noticeDueToday('2026-10-01', TODAY, T)).toBe(false)
  })

  it('без дата не праща', () => {
    expect(noticeDueToday(null, TODAY, T)).toBe(false)
  })

  it('прагът 0 праща в деня на изтичане, ако е зададен', () => {
    expect(noticeDueToday(TODAY, TODAY, [0])).toBe(true)
    expect(noticeDueToday(TODAY, TODAY, T)).toBe(false)
  })

  it('празен списък прагове не праща нищо', () => {
    expect(noticeDueToday('2026-10-20', TODAY, [])).toBe(false)
  })
})

describe('certsForNotice', () => {
  it('взима само удрящите праг, подредени по дата', () => {
    const certs = [
      cert('a', 'Фирма А', '2026-11-12'),  // 30 → да
      cert('b', 'Фирма Б', '2026-11-07'),  // 25 → не
      cert('c', 'Фирма В', '2026-10-20'),  // 7  → да
      cert('d', 'Фирма Г', null),          // без дата → не
    ]
    expect(certsForNotice(certs, TODAY, [30, 20, 7]).map(c => c.id)).toEqual(['c', 'a'])
  })

  it('празен резултат значи „днес няма писмо"', () => {
    expect(certsForNotice([cert('a', 'А', '2026-11-07')], TODAY, [30, 20, 7])).toEqual([])
  })
})

describe('sortByUrgency', () => {
  it('изтеклите най-отгоре, без дата — най-долу', () => {
    const certs = [
      cert('valid', 'Валиден', '2027-05-01'),
      cert('none', 'Без дата', null),
      cert('expired', 'Изтекъл', '2026-09-01'),
      cert('soon', 'Скоро', '2026-10-20'),
    ]
    expect(sortByUrgency(certs, TODAY).map(c => c.id))
      .toEqual(['expired', 'soon', 'valid', 'none'])
  })

  it('при равна дата подрежда по име, на български', () => {
    const certs = [cert('b', 'Янков', '2026-11-01'), cert('a', 'Ангелов', '2026-11-01')]
    expect(sortByUrgency(certs, TODAY).map(c => c.id)).toEqual(['a', 'b'])
  })

  it('не разбърква оригиналния масив', () => {
    const certs = [cert('a', 'А', '2027-01-01'), cert('b', 'Б', '2026-09-01')]
    sortByUrgency(certs, TODAY)
    expect(certs.map(c => c.id)).toEqual(['a', 'b'])
  })
})

describe('countByStatus', () => {
  it('брои по състояние и несвързаните', () => {
    const certs = [
      cert('1', 'А', '2027-01-01', 'client-1'),
      cert('2', 'Б', '2026-10-20'),
      cert('3', 'В', '2026-09-01'),
      cert('4', 'Г', null, 'client-2'),
    ]
    expect(countByStatus(certs, TODAY)).toEqual({
      valid: 1, expiring: 1, expired: 1, unknown: 1, unlinked: 2, total: 4,
    })
  })

  it('празен списък дава нули', () => {
    expect(countByStatus([], TODAY)).toEqual({
      valid: 0, expiring: 0, expired: 0, unknown: 0, unlinked: 0, total: 0,
    })
  })
})
