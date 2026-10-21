// Препратено писмо → ред във „Възможности".
//
// ТЕСТВАНОТО ОГЛЕДАЛО на разбора в edge функцията `mail-intake` — същата
// уговорка като при `rss.ts`/`news-fetch` и `mail-send`: функцията е един
// файл нарочно (ръчен деплой), затова кодът е повторен. Пипнеш ли правило
// от едната страна, пипни го и от другата.
//
// РАЗДЕЛЕНИЕТО Е НАРОЧНО: тук са нещата, които ТРЯБВА да са детерминирани —
// кой има право да праща, къде отива писмото и кое от отговора на модела се
// приема. Моделът върши само размитата част (чете свободен текст и предлага
// стойности) и не решава нищо от изброеното.

/** Домейнът на кантората — всеки от него има право да праща. */
export const FIRM_DOMAIN = 'consultplus.bg'

/**
 * Темата ТРЯБВА да съдържа тази дума, за да влезе писмото.
 *
 * Търси се „съдържа", не „започва с": препращането лепи отпред „Fwd:",
 * „FW:", „Препратено:" и какво ли не според пощенския клиент, а правило,
 * което зависи от това, би се чупило тихо при колега с друг клиент.
 */
export const KEYWORD = 'възможност'

/** Докъде се реже всяко поле — моделът не бива да надува реда. */
const MAX_LEN: Record<string, number> = {
  name: 200, contact_person: 120, contact_phone: 60,
  contact_email: 160, notes: 4000,
}

/**
 * Адресът от заглавката „From" — приема и „Име <a@b.bg>", и голо „a@b.bg".
 * Връща празно, ако не намери нещо, което да прилича на адрес.
 */
export function parseFromHeader(from: string | null | undefined): string {
  const raw = (from ?? '').trim()
  if (!raw) return ''
  const angled = raw.match(/<([^>]+)>/)
  const candidate = (angled ? angled[1] : raw).trim().toLowerCase()
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(candidate) ? candidate : ''
}

/**
 * Има ли право този подател да пише в базата.
 *
 * ДВЕ ВРАТИ: фирменият домейн (покрива и колегите без попълнен имейл в
 * Персонал — те са доста) ИЛИ изричен адрес от Персонал (покрива колега,
 * който препраща от друг домейн).
 *
 * ⚠️ Това НЕ е ключалка. Заглавката „From" се подправя; истинската проверка
 * е DMARC в едж функцията, а истинската защита е, че редът влиза непрегледан
 * в екран само за admin и нищо от писмото не се изпълнява.
 */
export function isAllowedSender(
  from: string | null | undefined,
  staffEmails: Array<string | null | undefined>,
): boolean {
  const addr = parseFromHeader(from)
  if (!addr) return false
  if (addr.endsWith('@' + FIRM_DOMAIN)) return true
  return staffEmails.some(e => (e ?? '').trim().toLowerCase() === addr)
}

/** Темата носи ли ключовата дума. Малки/главни нямат значение. */
export function hasKeyword(subject: string | null | undefined): boolean {
  return (subject ?? '').toLowerCase().includes(KEYWORD)
}

/**
 * ЕИК — САМО 9 или 13 цифри, иначе празно.
 *
 * Нарочно не се „поправя": 19-цифрен номер, минал през число, е загубен
 * номер (урокът от серийните номера на КЕП). По-добре празно поле, което
 * човек ще види, отколкото правдоподобно сгрешено.
 */
export function normalizeEik(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const digits = value.replace(/\D/g, '')
  return digits.length === 9 || digits.length === 13 ? digits : null
}

/** Имейл — или смислен адрес, или празно. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(v) ? v : null
}

/** Телефон — пазят се цифрите, „+" и разделителите; само цифри ли няма → празно. */
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (!/\d/.test(v)) return null
  const cleaned = v.replace(/[^\d+()\-\s/]/g, '').replace(/\s+/g, ' ').trim()
  return cleaned.length >= 6 ? cleaned.slice(0, MAX_LEN.contact_phone) : null
}

function text(value: unknown, field: string): string | null {
  if (typeof value !== 'string') return null
  const v = value.replace(/\s+/g, ' ').trim()
  return v ? v.slice(0, MAX_LEN[field]) : null
}

export interface OpportunityDraft {
  name: string
  eik: string | null
  contact_person: string | null
  contact_phone: string | null
  contact_email: string | null
  notes: string | null
}

export type ExtractionResult =
  | { ok: true; value: OpportunityDraft }
  | { ok: false; reason: string }

/**
 * Какво от отговора на модела се приема.
 *
 * ВСЯКО поле минава през своята проверка и невалидното става ПРАЗНО, не
 * „каквото е казал моделът". Единственото задължително е името — ред без
 * име е безполезен в списъка и е по-честно да откажем, отколкото да сложим
 * „(без име)" и да го оставим да стои.
 */
export function validateExtraction(raw: unknown): ExtractionResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'отговорът не е обект' }
  const o = raw as Record<string, unknown>

  const name = text(o.name, 'name')
  if (!name) return { ok: false, reason: 'липсва име на фирмата' }

  return {
    ok: true,
    value: {
      name,
      eik: normalizeEik(o.eik),
      contact_person: text(o.contact_person, 'contact_person'),
      contact_phone: normalizePhone(o.contact_phone),
      contact_email: normalizeEmail(o.contact_email),
      notes: text(o.notes, 'notes'),
    },
  }
}

export type IntakeVerdict =
  | { accept: true }
  | { accept: false; reason: string }

/**
 * Пуска ли се това писмо изобщо. Проверките са в този ред нарочно: първо
 * подателят (евтино и отрязва всичко чуждо), после темата.
 */
export function screenEmail(
  from: string | null | undefined,
  subject: string | null | undefined,
  staffEmails: Array<string | null | undefined>,
): IntakeVerdict {
  if (!isAllowedSender(from, staffEmails)) {
    return { accept: false, reason: 'подателят не е от кантората' }
  }
  if (!hasKeyword(subject)) {
    return { accept: false, reason: `темата не съдържа „${KEYWORD}"` }
  }
  return { accept: true }
}
