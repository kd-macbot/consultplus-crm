// ============================================================
// Производствен календар — официални празници и разместени дни.
//
// Чиста логика, за да е тествана. Данните идват от crm_holidays
// (мигр. 064), а това тук само ги превръща в бърза структура за
// търсене и отговаря на въпроса „този ден работен ли е".
//
// ДВЕ ПОСОКИ: освен неработни делнични дни има и обявени РАБОТНИ
// съботи (отработване на мост). Затова не е просто списък с
// празници — `is_working` обръща и сряда в почивен, и събота в
// работен ден.
// ============================================================

export interface Holiday {
  date: string       // ISO YYYY-MM-DD
  name: string
  is_working: boolean
}

/** Готов за търсене календар. Датите са ISO низове (YYYY-MM-DD). */
export interface WorkCalendar {
  /** Делнични дни, които НЕ се работят (празник, заместващ, мост). */
  nonWorking: Map<string, string>
  /** Съботи/недели, които СЕ работят (отработване). */
  working: Map<string, string>
}

/** Празен календар — само Пн-Пт, без празници. */
export const EMPTY_CALENDAR: WorkCalendar = { nonWorking: new Map(), working: new Map() }

export function buildWorkCalendar(rows: Holiday[] | undefined | null): WorkCalendar {
  const nonWorking = new Map<string, string>()
  const working = new Map<string, string>()
  for (const r of rows ?? []) {
    const d = (r?.date ?? '').slice(0, 10)
    if (!d) continue
    ;(r.is_working ? working : nonWorking).set(d, r.name ?? '')
  }
  return { nonWorking, working }
}

/** ISO низ (YYYY-MM-DD) от Date — по ЛОКАЛНО време.
 *
 * НЕ се ползва toISOString(): той минава през UTC и за дати преди
 * 03:00 българско време връща ПРЕДХОДНИЯ ден. Точно този капан
 * би преместил всеки празник с един ден назад.
 */
export function isoOf(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/** Работи ли се на тази дата? Пн-Пт, коригирано с календара. */
export function isWorkingDay(d: Date, cal: WorkCalendar): boolean {
  const iso = isoOf(d)
  const weekend = d.getDay() === 0 || d.getDay() === 6
  if (weekend) return cal.working.has(iso)
  return !cal.nonWorking.has(iso)
}

/** Името на повода за дадена дата, ако има ('' ако няма). */
export function holidayName(d: Date, cal: WorkCalendar): string {
  const iso = isoOf(d)
  return cal.nonWorking.get(iso) ?? cal.working.get(iso) ?? ''
}

/** Неработните делнични дни за дадена година, подредени — за страницата. */
export function holidaysOfYear(rows: Holiday[], year: number): Holiday[] {
  const p = `${year}-`
  return rows.filter(r => (r.date ?? '').startsWith(p))
    .sort((a, b) => a.date.localeCompare(b.date))
}
