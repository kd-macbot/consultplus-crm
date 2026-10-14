// ============================================================
// Часовник на връзката — контекстът, по който се разчита „записът виси".
// ============================================================
// ЖИВЕЕ В ОТДЕЛЕН ФАЙЛ, за да няма цикъл: пише се от `supabase.ts`
// (fetch слоя), чете се от `storage.ts` (докладването при провал).
//
// ЗАЩО Е ВЪВ FETCH СЛОЯ, а не в storage.ts (поправка 14.10.2026):
// първото измерване отчиташе само заявките през `withRetry`/`trackSave`.
// Но четенето на профила при вход минава направо през supabase-js, тоест
// успя (200 в breadcrumb-а), а часовникът не го видя — и `sinceLastOkMs`
// излезе равно на възрастта на страницата, сякаш връзката изобщо мълчи.
// Числото значеше нещо по-тясно от това, което твърдеше.

const pageLoadedAt = Date.now()

/** Кога за последно СЪРВЪРЪТ отговори — на каквото и да е. */
let lastOkAt = Date.now()
/** Колко заявки чакат отговор в момента. */
let inFlight = 0
/** Колко време табът е бил скрит непосредствено преди да се върне. */
let lastHiddenMs = 0
let hiddenSince: number | null = null

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenSince = Date.now()
    } else if (hiddenSince) {
      lastHiddenMs = Date.now() - hiddenSince
      hiddenSince = null
    }
  })
}

export function requestStarted(): void {
  inFlight++
}

/**
 * Заявката приключи. `ok` е true при ВСЯКАКЪВ отговор от сървъра — дори
 * 4xx значи, че връзката работи, а точно това мери часовникът.
 */
export function requestFinished(ok: boolean): void {
  inFlight = Math.max(0, inFlight - 1)
  if (ok) lastOkAt = Date.now()
}

export interface ConnectionSnapshot {
  sinceLastOkMs: number
  pageAgeMs: number
  inFlight: number
  lastHiddenMs: number
  hiddenNow: boolean | null
  online: boolean | null
}

export function connectionSnapshot(): ConnectionSnapshot {
  const now = Date.now()
  return {
    // Откога сървърът не се е обаждал. Малко число значи, че връзката
    // работи и застоялата връзка НЕ е обяснението.
    sinceLastOkMs: now - lastOkAt,
    pageAgeMs: now - pageLoadedAt,
    // Колко заявки чакат. Голямо число при млада страница значи, че
    // записът стои на опашка зад първоначалните тежки четения.
    inFlight,
    lastHiddenMs,
    hiddenNow: typeof document !== 'undefined' ? document.visibilityState === 'hidden' : null,
    online: typeof navigator !== 'undefined' ? navigator.onLine : null,
  }
}
