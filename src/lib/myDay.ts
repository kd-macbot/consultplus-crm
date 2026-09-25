// ============================================================
// „Моят ден" — чистата логика.
//
// Страницата само рисува това, което тези функции върнат. Изнесено е
// тук по същата причина, както при чек листа и известията: правилото
// „кое е мое и кое гори" живее на ТРИ места (тази страница, Личният
// чек лист и `mail-send` в Deno). Поне едното от тях да е тествано.
//
// ⚠️ Ако пипнеш правило тук, виж и `supabase/functions/mail-send` —
// писмото сутрин и екранът трябва да казват ЕДНО И СЪЩО. Колега,
// на когото писмото сочи пет фирми, а екранът три, спира да вярва и
// на двете.
// ============================================================

import { namesMatch } from './utils'
import { isWorkingDay, type WorkCalendar } from './holidays'

/** Кофите, в които попада една задача според срока ѝ. */
export type DueBucket = 'overdue' | 'today' | 'soon' | 'later' | 'none'

export interface DatedItem {
  /** ISO YYYY-MM-DD или null (задача без срок). */
  due_date: string | null
}

/**
 * В коя кофа попада срокът спрямо „днес".
 *
 * Сравнява се по ДАТА, не по час: задача със срок днес не става
 * просрочена в 00:01, а колега, който гледа екрана в 18:00, не бива
 * да вижда днешната като изтекла.
 */
export function dueBucket(dueIso: string | null, todayIso: string, soonDays = 7): DueBucket {
  if (!dueIso) return 'none'
  const d = dueIso.slice(0, 10)
  if (d < todayIso) return 'overdue'
  if (d === todayIso) return 'today'
  const limit = addDaysIso(todayIso, soonDays)
  return d <= limit ? 'soon' : 'later'
}

/** ISO дата + N дни → ISO дата (по локално време, без UTC капана). */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Колко КАЛЕНДАРНИ дни има между две ISO дати (b − a). */
export function daysBetweenIso(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00').getTime()
  const db = new Date(b + 'T00:00:00').getTime()
  return Math.round((db - da) / 86400000)
}

/**
 * Колко РАБОТНИ дни остават до срока (без днешния, с крайния).
 *
 * Работните дни са това, което колегата реално има — „остават 3 дни"
 * през коледната седмица е подвеждащо, ако два от тях са празници.
 */
export function workingDaysUntil(fromIso: string, toIso: string, cal: WorkCalendar): number {
  if (toIso <= fromIso) return 0
  let count = 0
  const cur = new Date(fromIso + 'T00:00:00')
  const end = new Date(toIso + 'T00:00:00')
  cur.setDate(cur.getDate() + 1)
  while (cur <= end) {
    if (isWorkingDay(cur, cal)) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

/** Човешки надпис за срок: „просрочена с 2 дни", „днес", „след 3 работни дни". */
export function dueLabel(dueIso: string | null, todayIso: string, cal: WorkCalendar): string {
  if (!dueIso) return 'без срок'
  const d = dueIso.slice(0, 10)
  if (d < todayIso) {
    const n = daysBetweenIso(d, todayIso)
    return n === 1 ? 'просрочена с 1 ден' : `просрочена с ${n} дни`
  }
  if (d === todayIso) return 'днес'
  const wd = workingDaysUntil(todayIso, d, cal)
  if (wd === 0) return 'утре е неработен ден'
  if (wd === 1) return 'остава 1 работен ден'
  return `остават ${wd} работни дни`
}

// ============================================================
// Кое е мое
// ============================================================

/**
 * Моя ли е фирмата — по „Счетоводител" ИЛИ „Отговорник".
 *
 * СРАВНЯВА СЕ С `namesMatch`, не с `===`. Двете колони са dropdown-и,
 * свързани със служител, и стойността е свободен текст: разлика в
 * един интервал прави фирмата чужда. Същото прави и `mail-send`.
 */
export function isMyFirm(
  firm: { accountant: string; responsible: string },
  myName: string,
): boolean {
  if (!myName.trim()) return false
  return namesMatch(firm.accountant, myName) || namesMatch(firm.responsible, myName)
}

/** Статуси, които НЕ влизат в ДДС чек листа (същите като в страницата). */
export function isChecklistExcludedStatus(status: string): boolean {
  const s = (status ?? '').toLowerCase()
  return s.includes('без дейност') || s.includes('без ддс') || s.includes('нулево')
}

// ============================================================
// Подредба
// ============================================================

export interface TaskLike extends DatedItem {
  id: string
  title: string
  status: string
}

/** Отворена ли е задачата — „Готово" и „Проблем" не чакат работа от мен. */
export function isOpenTask(t: { status: string }): boolean {
  return t.status !== 'done'
}

/**
 * Подрежда задачите за екрана: първо просрочените (най-старата отгоре),
 * после днешните, после наближаващите. Задачите БЕЗ срок отиват накрая —
 * те не горят, но не бива и да изчезват.
 */
export function sortByUrgency<T extends DatedItem>(items: T[], todayIso: string): T[] {
  const rank: Record<DueBucket, number> = { overdue: 0, today: 1, soon: 2, later: 3, none: 4 }
  return [...items].sort((a, b) => {
    const ra = rank[dueBucket(a.due_date, todayIso)]
    const rb = rank[dueBucket(b.due_date, todayIso)]
    if (ra !== rb) return ra - rb
    if (!a.due_date) return 0
    if (!b.due_date) return 0
    return a.due_date.localeCompare(b.due_date)
  })
}

// ============================================================
// Екипът днес
// ============================================================

export interface AbsenceLike {
  staff_id: string
  start_date: string
  end_date: string
  type: string
  status: string
}

/** Кой отсъства на дадена дата — само ОДОБРЕНИТЕ отсъствия.
 *  Генерична, за да върне СЪЩИТЕ обекти (с id-то им), а не орязани копия. */
export function absentOn<T extends AbsenceLike>(absences: T[], iso: string): T[] {
  return absences.filter(a =>
    a.status === 'approved' && a.start_date <= iso && a.end_date >= iso)
}

/**
 * Връща ли се някой утре — за реда „Мария се връща утре".
 *
 * „Утре" е следващият РАБОТЕН ден, не следващият календарен: в петък
 * следобед „връща се утре" за колега, който идва чак в понеделник, е
 * невярно.
 */
export function nextWorkingDay(iso: string, cal: WorkCalendar): string {
  let next = addDaysIso(iso, 1)
  let guard = 0
  while (!isWorkingDay(new Date(next + 'T00:00:00'), cal) && guard < 30) {
    next = addDaysIso(next, 1)
    guard++
  }
  return next
}

export function backOn<T extends AbsenceLike>(absences: T[], todayIso: string, cal: WorkCalendar): T[] {
  const nextDay = nextWorkingDay(todayIso, cal)
  const outToday = new Set(absentOn(absences, todayIso).map(a => a.staff_id))
  const outNext = new Set(absentOn(absences, nextDay).map(a => a.staff_id))
  return absentOn(absences, todayIso).filter(a => outToday.has(a.staff_id) && !outNext.has(a.staff_id))
}
