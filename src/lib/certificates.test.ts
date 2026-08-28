import { describe, it, expect } from 'vitest'
import {
  certStatus, daysLeft, daysBetween, normalizeSerial, looksLikeExcelFloat,
  looksTruncated, splitAssignee, CERT_STATUS_LABELS,
} from './certificates'

const TODAY = '2026-08-28'

describe('certStatus', () => {
  it('без зачислен колега и с валидна дата → свободен', () => {
    expect(certStatus('2028-10-27', null, TODAY)).toBe('free')
  })
  it('със зачислен колега → зачислен', () => {
    expect(certStatus('2028-10-27', 'staff-1', TODAY)).toBe('assigned')
  })
  it('изтекъл бие зачислението — проблем е, у когото и да стои', () => {
    expect(certStatus('2026-08-27', 'staff-1', TODAY)).toBe('expired')
    expect(certStatus('2026-08-27', null, TODAY)).toBe('expired')
  })
  it('в прозореца преди края → изтича скоро', () => {
    expect(certStatus('2026-10-20', 'staff-1', TODAY)).toBe('expiring')  // 53 дни
    expect(certStatus('2026-08-28', 'staff-1', TODAY)).toBe('expiring')  // днес
  })
  it('точно на границата на прозореца още е „изтича скоро"', () => {
    expect(certStatus('2026-10-27', null, TODAY)).toBe('expiring')       // 60 дни
    expect(certStatus('2026-10-28', null, TODAY)).toBe('free')           // 61 дни
  })
  it('без дата на валидност решава само зачислението', () => {
    expect(certStatus(null, null, TODAY)).toBe('free')
    expect(certStatus(null, 'staff-1', TODAY)).toBe('assigned')
    expect(certStatus('глупости', 'staff-1', TODAY)).toBe('assigned')
  })
})

describe('daysLeft / daysBetween', () => {
  it('брои цели дни напред и назад', () => {
    expect(daysLeft('2026-08-30', TODAY)).toBe(2)
    expect(daysLeft('2026-08-26', TODAY)).toBe(-2)
    expect(daysLeft(TODAY, TODAY)).toBe(0)
  })
  it('липсваща или нечетима дата → null', () => {
    expect(daysLeft(null, TODAY)).toBeNull()
    expect(daysLeft('не е дата', TODAY)).toBeNull()
  })
  it('прескача смяната на лятното време', () => {
    // 25.10.2026 е неделята, в която часовникът се връща назад.
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2)
  })
})

describe('normalizeSerial', () => {
  it('маха интервали и тирета', () => {
    expect(normalizeSerial(' 3356 7737-9738 5379401 ')).toEqual({
      value: '3356773797385379401', error: null, warning: null,
    })
  })
  it('хваща номер, минал през Excel като число', () => {
    const r = normalizeSerial('2.64549302217344e+18')
    expect(r.error).toContain('Excel')
    expect(looksLikeExcelFloat('8.5750648893582E+18')).toBe(true)
    expect(looksLikeExcelFloat('3356773797385379401')).toBe(false)
  })
  it('отказва букви', () => {
    expect(normalizeSerial('ABC123').error).toContain('само цифри')
  })
  it('празното е позволено — номерът може да дойде по-късно', () => {
    expect(normalizeSerial('')).toEqual({ value: '', error: null, warning: null })
    expect(normalizeSerial('   ')).toEqual({ value: '', error: null, warning: null })
  })
})

describe('looksTruncated', () => {
  it('хваща закръглените от Excel — 15 значещи цифри и нули отзад', () => {
    // Точно случаят от подадения файл: изглежда като цял 19-цифрен номер.
    expect(looksTruncated('2645493022173440000')).toBe(true)
    expect(looksTruncated('8575064889358200000')).toBe(true)
    expect(looksTruncated('116856180670558000')).toBe(true)
  })
  it('не пипа истинските номера', () => {
    expect(looksTruncated('3356773797385379401')).toBe(false)
  })
  it('къси номера и нецифрени не се проверяват', () => {
    expect(looksTruncated('120000')).toBe(false)
    // 15 цифри е границата — дотам плаващата запетая не губи нищо.
    expect(looksTruncated('100000000000000')).toBe(false)
    expect(looksTruncated('ABC0000')).toBe(false)
    expect(looksTruncated('')).toBe(false)
  })
  it('предупреждава, но НЕ отказва записа', () => {
    const r = normalizeSerial('2645493022173440000')
    expect(r.error).toBeNull()
    expect(r.warning).toContain('нули')
    expect(r.value).toBe('2645493022173440000')
  })
})

describe('splitAssignee', () => {
  it('разделя име и номер на устройството', () => {
    expect(splitAssignee('Ангел/5')).toEqual({ name: 'Ангел', deviceNo: '5' })
    expect(splitAssignee('Роси Диева / 0')).toEqual({ name: 'Роси Диева', deviceNo: '0' })
    expect(splitAssignee('Радка Николова / A')).toEqual({ name: 'Радка Николова', deviceNo: 'A' })
  })
  it('без наклонена черта всичко е име', () => {
    expect(splitAssignee('Калин Диев')).toEqual({ name: 'Калин Диев', deviceNo: '' })
  })
})

describe('етикети', () => {
  it('всеки статус има български етикет', () => {
    expect(Object.keys(CERT_STATUS_LABELS).sort())
      .toEqual(['assigned', 'expired', 'expiring', 'free'])
  })
})
