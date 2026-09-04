// ============================================================
// Карта на клиента — чистата логика (за да е тествана).
// Компонентът само рисува това, което тези функции върнат.
// ============================================================

/** Последните N работни месеца, най-новият пръв.
 *
 * „Работен месец" в кантората е ПРЕДХОДНИЯТ календарен — в март се
 * обработва февруари. Картата показва това, което реално се работи, а не
 * текущия календарен месец, в който още няма нищо попълнено.
 */
export function lastWorkMonths(today: Date, count = 3): Array<{ year: number; month: number }> {
  const out: Array<{ year: number; month: number }> = []
  // Първият е предходният спрямо днес.
  let y = today.getFullYear()
  let m = today.getMonth() // 0-базиран → това вече е предходният месец като 1-базиран
  if (m === 0) { y -= 1; m = 12 }
  for (let i = 0; i < count; i++) {
    out.push({ year: y, month: m })
    m -= 1
    if (m === 0) { y -= 1; m = 12 }
  }
  return out
}

/** ЕИК/ДДС за показване — липсващото е „—", не празно. */
export function orDash(v: string | null | undefined): string {
  const s = (v ?? '').trim()
  return s === '' ? '—' : s
}

/**
 * ДДС номерът на български фирми е ЕИК с представка BG. Ако в Контакти
 * стои само ЕИК, а фирмата е регистрирана, показваме BG+ЕИК — но САМО
 * когато има дата на регистрация. Иначе бихме твърдели регистрация,
 * каквато може да няма.
 */
export function vatDisplay(vatNumber: string | null, eik: string | null, registeredAt: string | null): string {
  const vat = (vatNumber ?? '').trim()
  if (vat !== '') return vat
  const e = (eik ?? '').trim()
  if (e !== '' && (registeredAt ?? '').trim() !== '') return `BG${e}`
  return '—'
}

/** Свършено/общо по отметките на месеца — за кратък ред „3 от 5". */
export function doneCount(flags: Array<boolean | null | undefined>): { done: number; total: number } {
  return { done: flags.filter(Boolean).length, total: flags.length }
}
