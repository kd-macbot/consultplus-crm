import type { Column, TrzWork } from './types'

// Стойности на мастер колоната „ТРЗ Статус" — контролира кои фирми влизат в
// ТРЗ Работен лист.
export const TRZ_ACTIVE = 'Активна'
export const TRZ_INACTIVE = 'НЕ Активна'

const uc = (s: string) => s.toUpperCase()

export interface TrzColumns {
  status?: Column   // „ТРЗ Статус" (Активна / НЕ Активна)
  forma?: Column    // „Форма на Осиг."
  resp?: Column     // ТРЗ отговорник (бившата „ТРЗ")
  software?: Column // „ТРЗ Софтуер" (ОМЕКС / МИКРО)
}

/**
 * Намира ТРЗ-свързаните мастер колони по име (устойчиво на леки разлики).
 * Единствен източник на истина — ползва се и в страницата, и в Таблото.
 */
export function findTrzColumns(columns: Column[]): TrzColumns {
  return {
    status: columns.find(c => { const n = uc(c.name); return n.includes('ТРЗ') && n.includes('СТАТУС') }),
    forma: columns.find(c => { const n = uc(c.name); return n.includes('ФОРМА') && n.includes('ОСИГ') }),
    resp: columns.find(c => { const n = uc(c.name); return n.includes('ТРЗ') && !n.includes('СТАТУС') && !n.includes('СОФТУЕР') }),
    software: columns.find(c => uc(c.name).includes('СОФТУЕР')),
  }
}

export interface TrzProgress {
  total: number
  salaries: number
  insurance: number
  payroll: number
  fullyDone: number
}

/** Брои напредъка по ТРЗ чеклистите за подадените (активни) клиенти. */
export function computeTrzProgress(
  activeClientIds: string[],
  workByClient: Map<string, TrzWork>,
): TrzProgress {
  let salaries = 0, insurance = 0, payroll = 0, fullyDone = 0
  for (const id of activeClientIds) {
    const w = workByClient.get(id)
    if (!w) continue
    if (w.salaries_prepared) salaries++
    if (w.insurance_submitted) insurance++
    if (w.payroll_sent) payroll++
    if (w.salaries_prepared && w.insurance_submitted && w.payroll_sent) fullyDone++
  }
  return { total: activeClientIds.length, salaries, insurance, payroll, fullyDone }
}
