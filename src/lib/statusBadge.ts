// Споделени цветове за статус-бадж — ползва се в Работен лист и Абонаменти.
const STATUS_BADGE: Record<string, string> = {
  'АКТИВНА': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  'НУЛЕВО': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
}

export function statusBadgeClass(s: string): string {
  if (STATUS_BADGE[s]) return STATUS_BADGE[s]
  if (s.toLowerCase().includes('без')) return 'bg-slate-200 text-slate-600 dark:bg-slate-700/40 dark:text-slate-400'
  return 'bg-muted text-foreground'
}
