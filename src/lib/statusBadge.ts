// Споделени цветове за статус-бадж — ползва се в Работен лист и Абонаменти.
const STATUS_BADGE: Record<string, string> = {
  'АКТИВНА': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  'НУЛЕВО': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  'НОВ': 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
}

export function statusBadgeClass(s: string): string {
  if (STATUS_BADGE[s]) return STATUS_BADGE[s]
  if (s.toLowerCase().includes('без')) return 'bg-slate-200 text-slate-600 dark:bg-slate-700/40 dark:text-slate-400'
  return 'bg-muted text-foreground'
}

/**
 * „Без дейност" и „Без ДДС" клиенти нямат месечна работа → не участват в
 * Работен лист и в месечните статистики. Case-insensitive.
 */
export function isHiddenStatus(s: string): boolean {
  const norm = s.toLowerCase().trim()
  return norm.includes('без дейност') || norm.includes('без ддс')
}

/** „Без дейност" — никаква месечна работа; скрити от Работен лист. */
export function isNoActivityStatus(s: string): boolean {
  return s.toLowerCase().trim().includes('без дейност')
}

/**
 * „Без ДДС" — нямат месечна ДДС декларация, но имат останалите атрибути
 * (чл. 55, авансови вноски, заплати…). Виждат се в Работен лист с
 * disabled ДДС полета.
 */
export function isNoVatStatus(s: string): boolean {
  return s.toLowerCase().trim().includes('без ддс')
}
