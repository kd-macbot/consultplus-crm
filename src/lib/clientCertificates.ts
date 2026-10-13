// Чиста логика за „Подписи на клиенти" (КЕП на клиентите, мигр. 065).
//
// ⚠️ НЕ Е `certificates.ts` — той е за подписите на КАНТОРАТА (с ПИН/ПУК,
// зачислени на колеги). Общото между двата е проверката на серийния номер
// и броенето на дни, затова те се ПОЛЗВАТ оттам, а не се преписват.
//
// Правилото „кога се праща писмо" е ПОВТОРЕНО в edge функцията mail-send
// (тя е един файл нарочно — виж CLAUDE.md). Пипнеш ли го тук, пипни го и
// там: екранът и писмото трябва да казват едно и също.

import { daysBetween } from './certificates'

export type ClientCertKind = 'professional' | 'personal'

export const CERT_KIND_LABELS: Record<ClientCertKind, string> = {
  professional: 'Професионален',
  personal: 'Персонален',
}

export type ClientCertStatus = 'valid' | 'expiring' | 'expired' | 'unknown'

export const CLIENT_CERT_STATUS_LABELS: Record<ClientCertStatus, string> = {
  valid: 'Валиден',
  expiring: 'Изтича скоро',
  expired: 'Изтекъл',
  unknown: 'Без дата',
}

export const CLIENT_CERT_STATUS_CLS: Record<ClientCertStatus, string> = {
  valid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  expiring: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  expired: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200',
  unknown: 'bg-muted text-muted-foreground',
}

/** „Изтича скоро" на екрана = до 30 дни, колкото е и първото напомняне. */
export const EXPIRING_SOON_DAYS = 30

/** Дни до изтичане; null при липсваща или нечетима дата. */
export function daysLeft(validTo: string | null | undefined, todayIso: string): number | null {
  if (!validTo) return null
  const d = daysBetween(todayIso, validTo)
  return isNaN(d) ? null : d
}

export function clientCertStatus(
  validTo: string | null | undefined,
  todayIso: string,
  soonDays = EXPIRING_SOON_DAYS,
): ClientCertStatus {
  const left = daysLeft(validTo, todayIso)
  if (left === null) return 'unknown'
  if (left < 0) return 'expired'
  if (left <= soonDays) return 'expiring'
  return 'valid'
}

/** „след 12 дни" / „днес" / „изтекъл преди 3 дни" — за писмото и за екрана. */
export function expiryLabel(left: number | null): string {
  if (left === null) return 'без дата'
  if (left < 0) {
    const n = Math.abs(left)
    return n === 1 ? 'изтекъл вчера' : `изтекъл преди ${n} дни`
  }
  if (left === 0) return 'изтича ДНЕС'
  if (left === 1) return 'изтича утре'
  return `след ${left} дни`
}

/**
 * Пада ли днес напомняне за този подпис.
 *
 * ТОЧНО СЪВПАДЕНИЕ, не „по-малко или равно". Причината е, че cron-ът
 * минава всеки ден: при „<=" подпис на 25 дни щеше да праща писмо всеки
 * ден от 30-ия до 21-ия и напомнянето щеше да стане шум, който никой не
 * чете. Цената е, че напълно пропуснат ден (графиците на GitHub са
 * „когато можем" — измерено, 03.09.2026 пускане изобщо нямаше) губи ЕДНО
 * напомняне; остават другите две, а екранът и баджът го показват през
 * цялото време.
 *
 * `0` значи „в деня на изтичане" и се ползва, ако е сложен в списъка.
 */
export function noticeDueToday(
  validTo: string | null | undefined,
  todayIso: string,
  thresholds: number[],
): boolean {
  const left = daysLeft(validTo, todayIso)
  if (left === null) return false
  return thresholds.includes(left)
}

export interface CertLike {
  id: string
  holder: string | null
  valid_to: string | null
  client_id?: string | null
  is_standalone?: boolean
}

/**
 * Какво да пише на реда. Фирмата е водеща — тя е това, което колегата
 * търси; човекът е второстепенен и може да липсва.
 *
 * Трите състояния на един ред (виж мигр. 066) се четат ТУК, за да няма
 * страница, която ги подрежда по своему.
 */
export function certLabel(
  cert: Pick<CertLike, 'holder' | 'client_id' | 'is_standalone'>,
  firmName: string | null | undefined,
): { primary: string; secondary: string | null } {
  if (cert.client_id) {
    return { primary: firmName || 'непозната фирма', secondary: cert.holder?.trim() || null }
  }
  if (cert.is_standalone) {
    return { primary: cert.holder?.trim() || 'без име', secondary: 'изолиран случай' }
  }
  return { primary: cert.holder?.trim() || 'без име', secondary: null }
}

/** Ред, който още чака да бъде свързан с фирма (не е и изолиран случай). */
export function isUnlinked(cert: Pick<CertLike, 'client_id' | 'is_standalone'>): boolean {
  return !cert.client_id && !cert.is_standalone
}

/**
 * Подписите за ДНЕШНОТО писмо. Връща само онези, които удрят праг днес —
 * писмо „ето всичко до 30 дни" всеки ден би било същият шум.
 */
export function certsForNotice<T extends CertLike>(
  certs: T[],
  todayIso: string,
  thresholds: number[],
): T[] {
  return certs
    .filter(c => noticeDueToday(c.valid_to, todayIso, thresholds))
    .sort((a, b) => (a.valid_to ?? '').localeCompare(b.valid_to ?? ''))
}

/**
 * Подредба за екрана: първо това, което гори. Изтеклите най-отгоре (те са
 * проблем СЕГА), после изтичащите, после валидните, а без дата — най-долу:
 * ред без дата не е спешен, той е непопълнен.
 */
export function sortByUrgency<T extends CertLike>(certs: T[], todayIso: string): T[] {
  const rank: Record<ClientCertStatus, number> = { expired: 0, expiring: 1, valid: 2, unknown: 3 }
  return [...certs].sort((a, b) => {
    const ra = rank[clientCertStatus(a.valid_to, todayIso)]
    const rb = rank[clientCertStatus(b.valid_to, todayIso)]
    if (ra !== rb) return ra - rb
    const na = a.holder ?? ''
    const nb = b.holder ?? ''
    if (!a.valid_to) return b.valid_to ? 1 : na.localeCompare(nb, 'bg')
    if (!b.valid_to) return -1
    if (a.valid_to !== b.valid_to) return a.valid_to.localeCompare(b.valid_to)
    return na.localeCompare(nb, 'bg')
  })
}

/** Броячите над таблицата (и баджът в менюто). */
export function countByStatus<T extends CertLike>(certs: T[], todayIso: string) {
  const out = { valid: 0, expiring: 0, expired: 0, unknown: 0, unlinked: 0, total: certs.length }
  for (const c of certs) {
    out[clientCertStatus(c.valid_to, todayIso)]++
    if (isUnlinked(c)) out.unlinked++
  }
  return out
}
