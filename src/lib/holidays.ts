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

// ============================================================
// Законовите празници за една година — по Кодекса на труда.
//
// Смятат се, не се преписват: фиксираните дати са в чл. 154,
// Великден е по изчисление, а правилото „празник в събота/неделя →
// следващият работен ден е неработен" (чл. 154, ал. 2) е механично.
//
// ⚠️ КАКВО ТОВА НЕ ЗНАЕ: разместванията („мостовете") се обявяват с
// ОТДЕЛНО решение на МС в края на предходната година и не следват от
// нищо. Те се добавят на ръка. Проверката е годишният сбор — сверява
// се с производствения календар на бранша.
// ============================================================

/**
 * Православният Великден (григорианска дата).
 *
 * Изчислението на Meeus дава ЮЛИАНСКА дата; за XX-XXI век разликата
 * с григорианския календар е 13 дни. След 2100 г. става 14 — затова
 * функцията важи до 2099 и това е проверено с тест.
 */
export function orthodoxEaster(year: number): Date {
  const a = year % 4
  const b = year % 7
  const c = year % 19
  const d = (19 * c + 15) % 30
  const e = (2 * a + 4 * b - d + 34) % 7
  const month = Math.floor((d + e + 114) / 31)   // 3 = март, 4 = април
  const day = ((d + e + 114) % 31) + 1
  const julian = new Date(year, month - 1, day)
  julian.setDate(julian.getDate() + 13)
  return julian
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

const MONTH_DAY = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`

/**
 * Законовите неработни ДЕЛНИЧНИ дни за годината, подредени.
 *
 * Връща само това, което влиза в таблицата: съботите и неделите не се
 * вписват (те и без това не се броят), а Великденските дни, паднали в
 * почивен ден, НЕ получават заместващ — изрично изключение в ал. 2.
 */
export function statutoryHolidays(year: number): Holiday[] {
  const easter = orthodoxEaster(year)

  // Подвижните. Разпети петък е винаги петък, Светли понеделник —
  // понеделник; другите два по определение падат в почивни дни.
  const easterDays: Array<{ d: Date; name: string }> = [
    { d: addDays(easter, -2), name: 'Разпети петък' },
    { d: addDays(easter, -1), name: 'Велика събота' },
    { d: easter, name: 'Великден' },
    { d: addDays(easter, 1), name: 'Светли понеделник' },
  ]

  const fixed: Array<{ d: Date; name: string }> = [
    { d: new Date(year, 0, 1), name: 'Нова година' },
    { d: new Date(year, 2, 3), name: 'Ден на Освобождението' },
    { d: new Date(year, 4, 1), name: 'Ден на труда' },
    { d: new Date(year, 4, 6), name: 'Гергьовден, Ден на храбростта' },
    { d: new Date(year, 4, 24), name: 'Св. св. Кирил и Методий' },
    { d: new Date(year, 8, 6), name: 'Съединение на България' },
    { d: new Date(year, 8, 22), name: 'Ден на Независимостта' },
    { d: new Date(year, 11, 24), name: 'Бъдни вечер' },
    { d: new Date(year, 11, 25), name: 'Рождество Христово' },
    { d: new Date(year, 11, 26), name: 'Рождество Христово - втори ден' },
  ]

  const out = new Map<string, string>()
  const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6

  // Делничните празници влизат както са.
  for (const { d, name } of [...fixed, ...easterDays]) {
    if (!isWeekend(d)) out.set(isoOf(d), name)
  }

  // Чл. 154, ал. 2 — фиксираните празници, паднали в събота/неделя,
  // избутват следващия свободен работен ден. Ако два празника паднат
  // в почивни дни (24 и 25 декември в събота и неделя), се изместват
  // ДВА дни — затова се търси първият НЕЗАЕТ работен ден.
  // Великденските са изключение и не участват.
  const weekendFixed = fixed
    .filter(x => isWeekend(x.d))
    .sort((a, b) => a.d.getTime() - b.d.getTime())

  for (const { d, name } of weekendFixed) {
    let next = addDays(d, 1)
    while (isWeekend(next) || out.has(isoOf(next))) next = addDays(next, 1)
    out.set(isoOf(next), `Заместващ за ${MONTH_DAY(d)} (${name})`)
  }

  return [...out.entries()]
    .map(([date, name]) => ({ date, name, is_working: false }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
