// ============================================================
// Таблицата Клиенти — замразени колони и брояч на филтрите.
//
// Чиста логика, за да е тествана: отместванията трябва да съвпадат
// с реално заетото място, иначе замразените колони се застъпват, а
// това е грешка, която се вижда чак на екран с много колони.
// ============================================================

export interface PinInput {
  /** Има ли колона с отметки (само admin/manager). */
  canEdit: boolean
  /** ID на колоната с името на фирмата (първата text колона). */
  nameColId: string | null
  /** ID на ПЪРВАТА видима колона — името се замразява само ако е то. */
  firstVisibleId: string | null
}

export interface PinLayout {
  /** Ширина в пиксели по ID. */
  width: Record<string, number>
  /** Отместване отляво в пиксели по ID. */
  left: Record<string, number>
}

export const PIN_WIDTH = { index: 50, select: 40, name: 220 } as const

/**
 * Кои колони се замразяват и къде застават.
 *
 * Името се замразява САМО когато си е на първо място. Ако колегата го
 * е извлачил по средата, замразяването би изскубнало колона от средата
 * на реда — затова тогава остават само „#" и отметката.
 */
export function computePinLayout({ canEdit, nameColId, firstVisibleId }: PinInput): PinLayout {
  const width: Record<string, number> = { _index: PIN_WIDTH.index }
  const left: Record<string, number> = { _index: 0 }
  let next = PIN_WIDTH.index

  if (canEdit) {
    width._select = PIN_WIDTH.select
    left._select = next
    next += PIN_WIDTH.select
  }
  if (nameColId && nameColId === firstVisibleId) {
    width[nameColId] = PIN_WIDTH.name
    left[nameColId] = next
  }
  return { width, left }
}

/** ID-то на най-дясната замразена колона — само тя носи сянката. */
export function lastPinnedId(layout: PinLayout): string | null {
  const ids = Object.keys(layout.left)
  if (ids.length === 0) return null
  return ids.reduce((a, b) => (layout.left[a] > layout.left[b] ? a : b))
}

/**
 * Колко неща стесняват списъка В МОМЕНТА.
 *
 * Филтрите се помнят в sessionStorage и оцеляват навигация — колега се
 * връща на страницата, вижда пет реда и не разбира защо. Числото до
 * бутона казва точно това.
 *
 * СКРИТИТЕ КОЛОНИ НЕ СЕ БРОЯТ: те са нагласа на екрана, не филтър. Едно
 * „изчисти" не бива да събаря подредбата, която колегата си е правил.
 */
export function countActiveFilters(args: {
  columnFilters: Array<{ id: string; value: unknown }>
  globalFilter: string
  tagFilter: string[]
}): number {
  const cols = args.columnFilters.filter(f => {
    const v = f.value
    if (v == null) return false
    if (typeof v === 'string') return v.trim() !== '' && v !== '|'
    return true
  }).length
  return cols + (args.globalFilter.trim() ? 1 : 0) + args.tagFilter.length
}
