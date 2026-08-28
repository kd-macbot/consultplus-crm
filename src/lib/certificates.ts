// Чиста логика за страница „Електронни подписи".
// Държи се отделно от компонента, за да е тествана — валидността на
// серийния номер и статусът на подписа са точно нещата, които не бива
// да се проверяват „на око".

export type CertStatus = 'free' | 'assigned' | 'expiring' | 'expired'

export const CERT_STATUS_LABELS: Record<CertStatus, string> = {
  free: 'Свободен',
  assigned: 'Зачислен',
  expiring: 'Изтича скоро',
  expired: 'Изтекъл',
}

export const CERT_STATUS_CLS: Record<CertStatus, string> = {
  free: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
  assigned: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  expiring: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  expired: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200',
}

/** По подразбиране „изтича скоро" = до 60 дни преди края на валидността. */
export const EXPIRING_DAYS = 60

/** Цели дни между две ISO дати (b − a). UTC, за да няма изненади с лятното време. */
export function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(`${aIso}T00:00:00Z`)
  const b = Date.parse(`${bIso}T00:00:00Z`)
  if (isNaN(a) || isNaN(b)) return NaN
  return Math.round((b - a) / 86_400_000)
}

/**
 * Статусът на подписа. Валидността бие зачислението: изтекъл подпис не е
 * „зает", той е проблем — независимо у кого стои.
 */
export function certStatus(
  validTo: string | null | undefined,
  assignedStaffId: string | null | undefined,
  todayIso: string,
  expiringDays = EXPIRING_DAYS,
): CertStatus {
  if (validTo) {
    const left = daysBetween(todayIso, validTo)
    if (!isNaN(left)) {
      if (left < 0) return 'expired'
      if (left <= expiringDays) return 'expiring'
    }
  }
  return assignedStaffId ? 'assigned' : 'free'
}

/** Дни до изтичане; null при липсваща или нечетима дата. */
export function daysLeft(validTo: string | null | undefined, todayIso: string): number | null {
  if (!validTo) return null
  const d = daysBetween(todayIso, validTo)
  return isNaN(d) ? null : d
}

/**
 * Изглежда ли номерът като минал през Excel като ЧИСЛО.
 * 19-цифрените серийни номера губят точност след 15-ата цифра и излизат
 * като „2.64549302217344e+18" — оригиналът е невъзстановим. Такъв вход не
 * бива да се записва мълчаливо, защото изглежда като данни, а не е.
 */
export function looksLikeExcelFloat(raw: string): boolean {
  return /^\s*[\d.]+\s*[eE][+-]?\d+\s*$/.test(raw)
}

/**
 * Номер, който ИЗГЛЕЖДА цял, но е закръглен от Excel.
 *
 * Правилото не е „много нули на края", а точното поведение на числото с
 * плаваща запетая: пазят се 15 значещи цифри, всичко след тях става нула.
 * Тоест подозрителен е номер по-дълъг от 15 цифри, чиято ОПАШКА СЛЕД
 * 15-ата цифра е само нули — „2645493022173440000" е точно това, докато
 * „3356773797385379401" минава чист.
 *
 * Не е доказателство (истински номер може да свърши на нули), затова е
 * ПРЕДУПРЕЖДЕНИЕ, не отказ: блокирането би спряло и валиден номер.
 */
export function looksTruncated(serial: string): boolean {
  const digits = (serial ?? '').replace(/[\s-]/g, '')
  if (!/^\d+$/.test(digits) || digits.length <= 15) return false
  return /^0+$/.test(digits.slice(15))
}

export interface SerialCheck { value: string; error: string | null; warning: string | null }

/**
 * Нормализира сериен номер: маха интервали и разделители, приема само
 * цифри (номерата на КЕП са десетични). Празното е позволено — редът може
 * да се създаде, преди номерът да е под ръка.
 */
export function normalizeSerial(raw: string): SerialCheck {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return { value: '', error: null, warning: null }
  if (looksLikeExcelFloat(trimmed)) {
    return {
      value: trimmed,
      error: 'Това е номер, минал през Excel като число — цифрите след 15-ата са загубени. Въведи го от източника.',
      warning: null,
    }
  }
  const cleaned = trimmed.replace(/[\s-]/g, '')
  if (!/^\d+$/.test(cleaned)) {
    return { value: cleaned, error: 'Серийният номер съдържа само цифри.', warning: null }
  }
  return {
    value: cleaned,
    error: null,
    warning: looksTruncated(cleaned)
      ? 'Номерът завършва с много нули — типичният белег на закръгляне от Excel. Сверѝ го със сертификата.'
      : null,
  }
}

/**
 * „Ангел/5", „Роси Диева / 0", „Радка Николова / A" → име + номер на
 * устройството. Форматът идва от стария Excel, където двете стояха в една
 * клетка. Ползва се при въвеждане на заварените редове.
 */
export function splitAssignee(raw: string): { name: string; deviceNo: string } {
  const parts = (raw ?? '').split('/')
  if (parts.length < 2) return { name: (raw ?? '').trim(), deviceNo: '' }
  return {
    name: parts[0].trim(),
    deviceNo: parts.slice(1).join('/').trim(),
  }
}
