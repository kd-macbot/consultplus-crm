// Филтрите на „Профили на клиенти" — по Счетоводител, Отговорник и Оценка.
//
// Логиката стои отделно, защото има две подробности, които се бъркат лесно:
//
// 1. „Счетоводител" и „Отговорник" са СВОБОДЕН ТЕКСТ (dropdown, свързан със
//    служител → стойността е във `value_text`). Тоест един и същи човек може
//    да стои записан с различни интервали или регистър. Списъкът за филтъра
//    се сглобява по НОРМАЛИЗИРАНО име, иначе „Иван Иванов" и „Иван  Иванов"
//    стават два реда в падащото меню и всеки показва част от фирмите.
// 2. Сравняването при филтриране минава през `namesMatch` по същата причина —
//    `===` беше точно бъгът, заради който личният чек лист и писмото сутрин
//    показваха различни фирми.

import { namesMatch, normalizeName } from './utils'

/** Стойност за „фирмите без зададен човек/оценка" в падащото меню. */
export const EMPTY_FILTER = '\u0000без'

export interface PeopleOptions {
  /** Имената за менюто — по едно на човек, подредени по азбучен ред. */
  names: string[]
  /** Има ли изобщо фирми без зададен човек (за да не се показва излишен избор). */
  hasEmpty: boolean
}

/**
 * Имената за падащото меню: по едно на ЧОВЕК, не на запис.
 *
 * Показва се ПЪРВИЯТ срещнат изпис на името. Нарочно не се „поправя" към
 * някакъв каноничен вид — това, което стои в Клиенти, е това, което колегата
 * разпознава.
 */
export function peopleOptions(values: Array<string | null | undefined>): PeopleOptions {
  const byNorm = new Map<string, string>()
  let hasEmpty = false
  for (const v of values) {
    const norm = normalizeName(v)
    if (!norm) { hasEmpty = true; continue }
    if (!byNorm.has(norm)) byNorm.set(norm, (v ?? '').trim().replace(/\s+/g, ' '))
  }
  return {
    names: [...byNorm.values()].sort((a, b) => a.localeCompare(b, 'bg')),
    hasEmpty,
  }
}

/**
 * Минава ли редът през филтър за човек.
 * Празен филтър = „всички". `EMPTY_FILTER` = само незададените.
 */
export function matchesPerson(value: string | null | undefined, filter: string): boolean {
  if (!filter) return true
  if (filter === EMPTY_FILTER) return normalizeName(value).length === 0
  return namesMatch(value, filter)
}

/**
 * Минава ли редът през филтър за оценка. Оценката е НАСТОЯЩ dropdown (id на
 * опция), затова тук се сравнява точно — за разлика от хората.
 */
export function matchesRating(optionId: string, filter: string): boolean {
  if (!filter) return true
  if (filter === EMPTY_FILTER) return optionId === ''
  return optionId === filter
}

/** Колко филтъра са активни — за брояча на бутона „Изчисти". */
export function activeFilterCount(f: {
  search: string
  accountant: string
  responsible: string
  rating: string
}): number {
  return [f.search.trim(), f.accountant, f.responsible, f.rating].filter(Boolean).length
}
