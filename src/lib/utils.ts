import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Нормализира име за сравняване (profile.full_name vs staff.full_name):
 *   - trim
 *   - collapse многократни whitespace до 1 интервал
 *   - lowercase (case-insensitive match)
 *
 * Случвало се е staff името да е „Иван  Петров" (двоен интервал) или с
 * различен casing. Без нормализация exact match връща false и потребителят
 * не намира свой ред в календара / справките.
 */
export function normalizeName(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeName(a) === normalizeName(b) && normalizeName(a).length > 0
}

export function formatCurrency(amount: number, currency = 'EUR') {
  return new Intl.NumberFormat('bg-BG', { style: 'currency', currency }).format(amount)
}

export const MONTH_NAMES = [
  'Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни',
  'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември',
]

/** ISO дата (YYYY-MM-DD) → DD.MM.YYYY. Празно → ''; невалидно → връща входа. */
export function formatDate(v: string | null | undefined): string {
  if (!v) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (m) return `${m[3]}.${m[2]}.${m[1]}`
  return v
}

/**
 * Предходен месец (1-индексиран) спрямо подадената дата. Работните листове
 * (Месечна / ТРЗ) винаги се водят месец назад — през юни се прави май.
 * Януари → декември на предходната година.
 */
export function previousMonth(d: Date = new Date()): { year: number; month: number } {
  const m = d.getMonth() // 0..11; текущ 1-индексиран = m + 1, предходен 1-индексиран = m
  if (m === 0) return { year: d.getFullYear() - 1, month: 12 }
  return { year: d.getFullYear(), month: m }
}
