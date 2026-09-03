import type { CashRegisterTurnover } from './types'

/**
 * Годишен оборот на ЕДИН касов апарат — така, както го водят колегите:
 *   КА     = сборът на оборота за годината (20% + 9%)
 *   СТОРНО = сборът на сторното за годината (20% + 9%)
 *   КО     = КА − СТОРНО
 *
 * Ставките се СЪБИРАТ, не се разделят: справката е за оборота на апарата,
 * а не за ДДС. Разбивката по ставки си стои в месечната таблица.
 *
 * Липсващ месец (никой не е въвеждал) е нула, не пропуск — затова се подават
 * само наличните записи.
 */
export function annualTurnover(months: Array<CashRegisterTurnover | undefined>): {
  ka: number; storno: number; ko: number
} {
  let ka = 0
  let storno = 0
  for (const t of months) {
    if (!t) continue
    ka += t.turnover_20 + t.turnover_9
    storno += t.storno_20 + t.storno_9
  }
  return { ka, storno, ko: ka - storno }
}
