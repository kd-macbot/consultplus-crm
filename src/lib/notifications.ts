// Чиста логика за страницата „Известия". Изпращането живее в edge
// функцията mail-send; тук са само нещата, които UI-ът смята сам —
// и които могат да се тестват без Supabase.

import type { NotificationKind, NotificationResult, NotificationStatus } from './types'

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  task_due: 'Задачи',
  checklist_dds: 'Чек лист (ДДС)',
  manual: 'Ръчно',
  test: 'Пробно',
}

export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  pending: 'Заявено',
  sent: 'Изпратено',
  error: 'Грешка',
}

export const NOTIFICATION_STATUS_CLS: Record<NotificationStatus, string> = {
  pending: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
  sent: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  error: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200',
}

/** Същата проверка като в edge функцията — да не пращаме явен боклук. */
export function isValidEmail(s: string | null | undefined): boolean {
  return !!s && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim())
}

/**
 * „11, 13" → [11, 13]. Дублираните се махат, подредбата е възходяща.
 * Извън 1–28 отпада: 29–31 ги няма всеки месец, а срокът за ДДС е 14-ти,
 * тоест напомняне на 30-то е безсмислено.
 */
export function parseChecklistDays(input: string): number[] {
  const seen = new Set<number>()
  for (const part of input.split(/[\s,;]+/)) {
    if (!part) continue
    const n = Number(part)
    if (!Number.isInteger(n) || n < 1 || n > 28) continue
    seen.add(n)
  }
  return [...seen].sort((a, b) => a - b)
}

export function formatChecklistDays(days: number[] | null | undefined): string {
  return (days ?? []).join(', ')
}

/**
 * Обобщение на отговора от edge функцията за toast-а:
 * „Изпратени 3, прескочени 2, с грешка 1".
 */
export function summarizeResults(results: NotificationResult[]): string {
  const sent = results.filter(r => r.status === 'sent').length
  const skipped = results.filter(r => r.status === 'skipped').length
  const errors = results.filter(r => r.status === 'error').length
  const parts: string[] = []
  if (sent) parts.push(`изпратени ${sent}`)
  if (skipped) parts.push(`прескочени ${skipped}`)
  if (errors) parts.push(`с грешка ${errors}`)
  return parts.length > 0 ? parts.join(', ') : 'няма какво да се изпрати'
}
