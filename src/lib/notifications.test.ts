import { describe, it, expect } from 'vitest'
import {
  isValidEmail, parseChecklistDays, formatChecklistDays, summarizeResults,
  NOTIFICATION_KIND_LABELS, NOTIFICATION_STATUS_LABELS,
} from './notifications'
import type { NotificationResult } from './types'

describe('isValidEmail', () => {
  it('приема нормални адреси', () => {
    expect(isValidEmail('ivan@cplus360.com')).toBe(true)
    expect(isValidEmail('  ivan.petrov+crm@example.co.uk  ')).toBe(true)
  })
  it('отхвърля празно и очевидно счупено', () => {
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail(null)).toBe(false)
    expect(isValidEmail(undefined)).toBe(false)
    expect(isValidEmail('ivan')).toBe(false)
    expect(isValidEmail('ivan@')).toBe(false)
    expect(isValidEmail('ivan@localhost')).toBe(false)
    expect(isValidEmail('ivan @example.com')).toBe(false)
  })
})

describe('parseChecklistDays', () => {
  it('парсва запетаи, точка и запетая и интервали', () => {
    expect(parseChecklistDays('11, 13')).toEqual([11, 13])
    expect(parseChecklistDays('11;13 5')).toEqual([5, 11, 13])
  })
  it('маха дублирани и подрежда', () => {
    expect(parseChecklistDays('13, 11, 13')).toEqual([11, 13])
  })
  it('изхвърля извън 1–28 и нечисловите', () => {
    // 29–31 ги няма всеки месец; 0 и отрицателните са безсмислени.
    expect(parseChecklistDays('0, 29, 31, 40, -3, абв')).toEqual([])
    expect(parseChecklistDays('1, 28, 29')).toEqual([1, 28])
  })
  it('празен вход → празен масив', () => {
    expect(parseChecklistDays('')).toEqual([])
    expect(parseChecklistDays('   ')).toEqual([])
  })
  it('формат и парсване са обратими', () => {
    expect(parseChecklistDays(formatChecklistDays([11, 13]))).toEqual([11, 13])
    expect(formatChecklistDays(null)).toBe('')
  })
})

describe('summarizeResults', () => {
  const r = (status: NotificationResult['status']): NotificationResult =>
    ({ to: 'a@b.bg', kind: 'task_due', subject: 'x', status })

  it('брои по статус', () => {
    expect(summarizeResults([r('sent'), r('sent'), r('skipped'), r('error')]))
      .toBe('изпратени 2, прескочени 1, с грешка 1')
  })
  it('пропуска нулевите групи', () => {
    expect(summarizeResults([r('sent')])).toBe('изпратени 1')
  })
  it('празен резултат казва това, а не „изпратени 0"', () => {
    expect(summarizeResults([])).toBe('няма какво да се изпрати')
  })
})

describe('етикети', () => {
  it('всеки вид и статус има български етикет', () => {
    expect(Object.keys(NOTIFICATION_KIND_LABELS).sort())
      .toEqual(['checklist_dds', 'manual', 'task_due', 'test'])
    expect(Object.keys(NOTIFICATION_STATUS_LABELS).sort())
      .toEqual(['error', 'pending', 'sent'])
  })
})
