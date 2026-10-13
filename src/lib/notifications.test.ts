import { describe, it, expect } from 'vitest'
import {
  isValidEmail, parseChecklistDays, parseNoticeDays, formatChecklistDays, summarizeResults,
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
      .toEqual(['checklist_dds', 'client_cert_expiry', 'manual', 'task_due', 'test'])
    expect(Object.keys(NOTIFICATION_STATUS_LABELS).sort())
      .toEqual(['error', 'pending', 'sent'])
  })
})

describe('parseNoticeDays', () => {
  it('чете праговете и ги подрежда низходящо', () => {
    expect(parseNoticeDays('7, 30, 20')).toEqual([30, 20, 7])
  })

  it('приема нула — „в деня на изтичане"', () => {
    expect(parseNoticeDays('0, 7')).toEqual([7, 0])
  })

  it('приема прагове над 28, за разлика от датите на чек листа', () => {
    // Точно заради това е отделна функция: parseChecklistDays реже над 28,
    // а „60 дни преди" е напълно разумен праг.
    expect(parseNoticeDays('60, 90')).toEqual([90, 60])
    expect(parseChecklistDays('60, 90')).toEqual([])
  })

  it('маха повторенията и боклука', () => {
    expect(parseNoticeDays('30, 30, абв, -5, 7, 400')).toEqual([30, 7])
  })

  it('празен вход дава празен списък', () => {
    expect(parseNoticeDays('')).toEqual([])
    expect(parseNoticeDays('   ')).toEqual([])
  })

  it('разделителите са интервал, запетая и точка и запетая', () => {
    expect(parseNoticeDays('30;20 7')).toEqual([30, 20, 7])
  })
})
