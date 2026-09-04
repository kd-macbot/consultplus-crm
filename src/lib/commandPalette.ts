// ============================================================
// Бързо търсене (Ctrl+K) — подреждането на резултатите.
//
// Чиста логика, за да е тествана: компонентът само рисува това, което
// `rankCommands` върне.
// ============================================================

export type CommandKind = 'page' | 'client'

export interface CommandEntry {
  id: string
  kind: CommandKind
  label: string
  /** Втори ред под името (напр. „Клиент"), само за показване. */
  hint?: string
}

/**
 * Търсенето е на български, а колегите пишат както им дойде: с малки букви,
 * с „Ё“-подобни разлики няма, но регистърът и излишните интервали са всекидневни.
 * Затова се сравнява по нормализиран вид.
 */
export function normalize(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[„“"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Колко добре съвпада записът със заявката. По-голямото е по-добро,
 * 0 = не съвпада изобщо.
 *
 * Подредбата е по СМИСЪЛ, не по азбука:
 *   4 — точно това е
 *   3 — започва с търсеното („кас" → „Касови апарати")
 *   2 — дума в името започва с търсеното („апарат" → „Касови апарати")
 *   1 — среща се някъде вътре
 * Иначе колега, който пише „кас", получава първо фирма с „кас" в средата
 * на името, а страницата, която търси, е на десето място.
 */
export function scoreMatch(label: string, query: string): number {
  const l = normalize(label)
  const q = normalize(query)
  if (!q) return 0
  if (l === q) return 4
  if (l.startsWith(q)) return 3
  if (l.split(' ').some(w => w.startsWith(q))) return 2
  if (l.includes(q)) return 1
  return 0
}

export interface RankOptions {
  /** Колко най-много резултата да се върнат (по подразбиране 12). */
  limit?: number
}

/**
 * Подрежда записите по съвпадение. При равен резултат страниците са преди
 * фирмите — те са малко и се търсят по-често, а фирмите са 186 и биха
 * изтласкали менюто надолу.
 */
export function rankCommands(entries: CommandEntry[], query: string, opts: RankOptions = {}): CommandEntry[] {
  const limit = opts.limit ?? 12
  const q = normalize(query)
  if (!q) return entries.filter(e => e.kind === 'page').slice(0, limit)

  const scored: Array<{ e: CommandEntry; score: number }> = []
  for (const e of entries) {
    const score = scoreMatch(e.label, q)
    if (score > 0) scored.push({ e, score })
  }
  scored.sort((a, b) =>
    b.score - a.score ||
    kindRank(a.e.kind) - kindRank(b.e.kind) ||
    a.e.label.localeCompare(b.e.label, 'bg'))
  return scored.slice(0, limit).map(x => x.e)
}

function kindRank(k: CommandKind): number {
  return k === 'page' ? 0 : 1
}

/**
 * Ctrl+K / ⌘K ли е това?
 *
 * КИРИЛИЦА: при българска подредба същият физически клавиш дава
 * `key === 'к'` (кирилско ка), не 'k'. Проверка само по `key` не хващаше
 * нищо и шорткътът отиваше при браузъра — в Chrome Ctrl+K е „търси в
 * адресната лента". Затова водещо е `code` (физическият клавиш, независим
 * от подредбата), а `key` е резерва за клавиатури без `code`.
 *
 * Alt се изключва: Ctrl+Alt+K е друга комбинация (на някои подредби е и
 * начин за въвеждане на знак).
 */
export function isPaletteHotkey(e: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; key?: string; code?: string }): boolean {
  if (!(e.ctrlKey || e.metaKey)) return false
  if (e.altKey) return false
  const k = (e.key ?? '').toLowerCase()
  return e.code === 'KeyK' || k === 'k' || k === 'к'
}
