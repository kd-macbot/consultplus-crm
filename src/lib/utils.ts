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

/**
 * Стаж между две дати — години + месеци + дни. Връща обект и
 * форматиран текст за UI. ISO формат (YYYY-MM-DD).
 *
 * Пример: hire=2023-03-15, today=2026-06-22 → { years: 3, months: 3, days: 7,
 * label: '3 г. 3 м. 7 дни' }
 */
export function calcTenure(hireIso: string | null | undefined, asOf: Date = new Date()):
  { years: number; months: number; days: number; totalMonths: number; label: string } | null
{
  if (!hireIso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(hireIso)
  if (!m) return null
  const hire = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10))
  if (isNaN(hire.getTime()) || hire > asOf) return null

  let years = asOf.getFullYear() - hire.getFullYear()
  let months = asOf.getMonth() - hire.getMonth()
  let days = asOf.getDate() - hire.getDate()
  if (days < 0) {
    months -= 1
    const prevMonthEnd = new Date(asOf.getFullYear(), asOf.getMonth(), 0).getDate()
    days += prevMonthEnd
  }
  if (months < 0) { years -= 1; months += 12 }

  const totalMonths = years * 12 + months
  const parts: string[] = []
  if (years > 0) parts.push(`${years} г.`)
  if (months > 0) parts.push(`${months} м.`)
  if (years === 0 && months === 0) parts.push(`${days} дни`)
  return { years, months, days, totalMonths, label: parts.join(' ') }
}

/**
 * „Преди X" формат за timestamps (ISO). Връща компактен текст:
 *   < 1 мин → „току-що"
 *   < 60 мин → „преди X мин."
 *   < 24 ч → „преди X ч."
 *   < 7 дни → „преди X дни"
 *   иначе → „DD.MM.YYYY HH:MM"
 */
export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'току-що'
  if (diffMin < 60) return `преди ${diffMin} мин.`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `преди ${diffH} ч.`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return `преди ${diffD} ${diffD === 1 ? 'ден' : 'дни'}`
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mn = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm}.${yy} ${hh}:${mn}`
}

// ============================================================
// Работни дни (Пн-Пт, без официални празници) — ЕДИНСТВЕНАТА
// имплементация. Ползва се от Календар, Справка отпуска, Заявки и
// Форма 76. Ако някога добавим официални празници, пипаме само тук.
// ============================================================

function parseIsoDate(iso: string): Date {
  return new Date(iso + 'T00:00:00')
}

/** Брой работни дни (Пн-Пт) в затворен интервал [from..to]. */
function countWorkdays(from: Date, to: Date): number {
  if (from > to) return 0
  let count = 0
  const cur = new Date(from)
  while (cur <= to) {
    const dow = cur.getDay()
    if (dow !== 0 && dow !== 6) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

/** Работни дни между две ISO дати (вкл. двете граници). */
export function workingDaysBetween(startIso: string, endIso: string): number {
  return countWorkdays(parseIsoDate(startIso), parseIsoDate(endIso))
}

/** Работни дни от диапазона [start..end], попадащи в дадената година. */
export function workingDaysInYear(startIso: string, endIso: string, year: number): number {
  const yearStart = new Date(year, 0, 1)
  const yearEnd = new Date(year, 11, 31)
  const a = parseIsoDate(startIso)
  const b = parseIsoDate(endIso)
  return countWorkdays(a < yearStart ? yearStart : a, b > yearEnd ? yearEnd : b)
}

/** Работни дни от диапазона [start..end], попадащи в дадения месец (1-12). */
export function workingDaysInMonth(startIso: string, endIso: string, year: number, month: number): number {
  const monthStart = new Date(year, month - 1, 1)
  const monthEnd = new Date(year, month, 0)
  const a = parseIsoDate(startIso)
  const b = parseIsoDate(endIso)
  return countWorkdays(a < monthStart ? monthStart : a, b > monthEnd ? monthEnd : b)
}

/** Общ брой работни дни в целия месец (1-12). */
export function workingDaysInMonthTotal(year: number, month: number): number {
  return countWorkdays(new Date(year, month - 1, 1), new Date(year, month, 0))
}

/** ISO timestamp → „DD.MM.YYYY HH:MM". Празно → ''. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mn = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm}.${yy} ${hh}:${mn}`
}

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
