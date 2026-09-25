import { describe, it, expect } from 'vitest'
import {
  dueBucket, addDaysIso, daysBetweenIso, workingDaysUntil, dueLabel,
  isMyFirm, isChecklistExcludedStatus, isOpenTask, sortByUrgency,
  absentOn, nextWorkingDay, backOn,
} from './myDay'
import { buildWorkCalendar, EMPTY_CALENDAR } from './holidays'

// Коледната седмица на 2026: 24, 25 и 28 декември са неработни.
const cal = buildWorkCalendar([
  { date: '2026-12-24', name: 'Бъдни вечер', is_working: false },
  { date: '2026-12-25', name: 'Рождество Христово', is_working: false },
  { date: '2026-12-28', name: 'Заместващ', is_working: false },
])

describe('dueBucket', () => {
  it('вчера е просрочена, днес е днес, утре наближава', () => {
    expect(dueBucket('2026-09-24', '2026-09-25')).toBe('overdue')
    expect(dueBucket('2026-09-25', '2026-09-25')).toBe('today')
    expect(dueBucket('2026-09-26', '2026-09-25')).toBe('soon')
  })

  it('далечният срок не влиза в „наближава"', () => {
    expect(dueBucket('2026-11-01', '2026-09-25')).toBe('later')
  })

  it('точно на границата на прозореца ОЩЕ наближава', () => {
    expect(dueBucket('2026-10-02', '2026-09-25', 7)).toBe('soon')
    expect(dueBucket('2026-10-03', '2026-09-25', 7)).toBe('later')
  })

  it('задача без срок не гори', () => {
    expect(dueBucket(null, '2026-09-25')).toBe('none')
  })

  it('сравнява по ДАТА, не по час — timestamp се реже', () => {
    expect(dueBucket('2026-09-25T23:00:00Z', '2026-09-25')).toBe('today')
  })
})

describe('addDaysIso', () => {
  it('минава през край на месец и на година', () => {
    expect(addDaysIso('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('назад също', () => {
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('daysBetweenIso', () => {
  it('брои календарни дни', () => {
    expect(daysBetweenIso('2026-09-20', '2026-09-25')).toBe(5)
    expect(daysBetweenIso('2026-09-25', '2026-09-25')).toBe(0)
  })
})

describe('workingDaysUntil', () => {
  it('БЕЗ днешния, С крайния', () => {
    // пн 21.09 → чт 24.09: вт, ср, чт = 3
    expect(workingDaysUntil('2026-09-21', '2026-09-24', EMPTY_CALENDAR)).toBe(3)
  })

  it('прескача уикенда', () => {
    // пт 25.09 → пн 28.09 = 1 работен ден
    expect(workingDaysUntil('2026-09-25', '2026-09-28', EMPTY_CALENDAR)).toBe(1)
  })

  it('празниците НЕ се броят за оставащи дни', () => {
    // ср 23.12 → вт 29.12. Без календар: 24,25,28,29 = 4.
    // С календара 24, 25 и 28 са празници → остава само 29-ти.
    expect(workingDaysUntil('2026-12-23', '2026-12-29', EMPTY_CALENDAR)).toBe(4)
    expect(workingDaysUntil('2026-12-23', '2026-12-29', cal)).toBe(1)
  })

  it('минал срок е 0, не отрицателно число', () => {
    expect(workingDaysUntil('2026-09-25', '2026-09-20', cal)).toBe(0)
  })
})

describe('dueLabel', () => {
  it('просрочената казва с колко', () => {
    expect(dueLabel('2026-09-24', '2026-09-25', cal)).toBe('просрочена с 1 ден')
    expect(dueLabel('2026-09-22', '2026-09-25', cal)).toBe('просрочена с 3 дни')
  })
  it('днешната е просто „днес"', () => {
    expect(dueLabel('2026-09-25', '2026-09-25', cal)).toBe('днес')
  })
  it('бъдещата брои РАБОТНИ дни', () => {
    expect(dueLabel('2026-12-29', '2026-12-23', cal)).toBe('остава 1 работен ден')
    expect(dueLabel('2026-12-29', '2026-12-23', EMPTY_CALENDAR)).toBe('остават 4 работни дни')
  })
  it('без срок си го казва', () => {
    expect(dueLabel(null, '2026-09-25', cal)).toBe('без срок')
  })
})

describe('isMyFirm', () => {
  const me = 'Иван Петров Иванов'

  it('хваща и счетоводителя, и отговорника', () => {
    expect(isMyFirm({ accountant: me, responsible: 'Друг' }, me)).toBe(true)
    expect(isMyFirm({ accountant: 'Друг', responsible: me }, me)).toBe(true)
  })

  it('чуждата фирма не е моя', () => {
    expect(isMyFirm({ accountant: 'Друг', responsible: 'Трети' }, me)).toBe(false)
  })

  it('разлика в интервалите и регистъра НЕ прави фирмата чужда', () => {
    // Точно това чупеше при сравнение с ===.
    expect(isMyFirm({ accountant: '  иван   петров  иванов ', responsible: '' }, me)).toBe(true)
  })

  it('празно име не съвпада с нищо — иначе всички фирми стават мои', () => {
    expect(isMyFirm({ accountant: '', responsible: '' }, '')).toBe(false)
    expect(isMyFirm({ accountant: 'Друг', responsible: '' }, '   ')).toBe(false)
  })
})

describe('isChecklistExcludedStatus', () => {
  it('без дейност, без ДДС и нулево отпадат', () => {
    expect(isChecklistExcludedStatus('Без дейност')).toBe(true)
    expect(isChecklistExcludedStatus('БЕЗ ДДС')).toBe(true)
    expect(isChecklistExcludedStatus('Нулево')).toBe(true)
  })
  it('активната остава', () => {
    expect(isChecklistExcludedStatus('Активна')).toBe(false)
    expect(isChecklistExcludedStatus('')).toBe(false)
  })
})

describe('isOpenTask', () => {
  it('готовата не чака работа, проблемната чака', () => {
    expect(isOpenTask({ status: 'done' })).toBe(false)
    expect(isOpenTask({ status: 'issue' })).toBe(true)
    expect(isOpenTask({ status: 'todo' })).toBe(true)
  })
})

describe('sortByUrgency', () => {
  it('просрочени → днес → наближаващи → далечни → без срок', () => {
    const items = [
      { id: 'later', due_date: '2026-12-01' },
      { id: 'none', due_date: null },
      { id: 'today', due_date: '2026-09-25' },
      { id: 'overdue', due_date: '2026-09-20' },
      { id: 'soon', due_date: '2026-09-28' },
    ]
    expect(sortByUrgency(items, '2026-09-25').map(i => i.id))
      .toEqual(['overdue', 'today', 'soon', 'later', 'none'])
  })

  it('в една кофа най-старият срок е отгоре', () => {
    const items = [
      { id: 'b', due_date: '2026-09-22' },
      { id: 'a', due_date: '2026-09-18' },
    ]
    expect(sortByUrgency(items, '2026-09-25').map(i => i.id)).toEqual(['a', 'b'])
  })

  it('не мутира входа', () => {
    const items = [{ id: 'b', due_date: '2026-09-22' }, { id: 'a', due_date: '2026-09-18' }]
    sortByUrgency(items, '2026-09-25')
    expect(items[0].id).toBe('b')
  })
})

describe('absentOn', () => {
  const abs = [
    { staff_id: 's1', start_date: '2026-09-21', end_date: '2026-09-25', type: 'vacation', status: 'approved' },
    { staff_id: 's2', start_date: '2026-09-25', end_date: '2026-09-25', type: 'sick', status: 'pending' },
    { staff_id: 's3', start_date: '2026-09-28', end_date: '2026-09-30', type: 'vacation', status: 'approved' },
  ]

  it('хваща отсъствие, което ОБХВАЩА деня (не само започва в него)', () => {
    expect(absentOn(abs, '2026-09-23').map(a => a.staff_id)).toEqual(['s1'])
  })

  it('границите влизат', () => {
    expect(absentOn(abs, '2026-09-21')).toHaveLength(1)
    expect(absentOn(abs, '2026-09-25').map(a => a.staff_id)).toEqual(['s1'])
  })

  it('НЕодобрените не се показват като отсъстващи', () => {
    // s2 е pending за 25-ти и не бива да се води отсъстващ.
    expect(absentOn(abs, '2026-09-25').some(a => a.staff_id === 's2')).toBe(false)
  })
})

describe('nextWorkingDay', () => {
  it('в петък следващият работен е понеделник', () => {
    expect(nextWorkingDay('2026-09-25', EMPTY_CALENDAR)).toBe('2026-09-28')
  })
  it('прескача и празниците', () => {
    // 23.12 (ср) → 24 и 25 са празници, 26-27 уикенд, 28 празник → 29.12
    expect(nextWorkingDay('2026-12-23', cal)).toBe('2026-12-29')
  })
})

describe('backOn', () => {
  const abs = [
    { staff_id: 's1', start_date: '2026-09-21', end_date: '2026-09-25', type: 'vacation', status: 'approved' },
    { staff_id: 's2', start_date: '2026-09-21', end_date: '2026-10-05', type: 'vacation', status: 'approved' },
  ]

  it('връща само тези, които утре ги няма в списъка', () => {
    // В петък 25.09 следващият работен е понеделник 28.09.
    // s1 свършва днес → връща се. s2 продължава → не.
    expect(backOn(abs, '2026-09-25', EMPTY_CALENDAR).map(a => a.staff_id)).toEqual(['s1'])
  })

  it('по средата на отпуската никой не се връща', () => {
    expect(backOn(abs, '2026-09-23', EMPTY_CALENDAR)).toHaveLength(0)
  })
})
