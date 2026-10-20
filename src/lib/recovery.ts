// Споделено auto-recovery: при детекция на „забит" клиент → soft reload.
//
// Защо отделен модул: trigger-ите идват от различни места (visibility
// handler в AuthProvider, withRetry в storage.ts, потенциално други) и
// всички трябва да споделят един backoff guard, за да не loop-ват.

// Двоен guard: минимум 5s между reload-и + max 4 reload-а в 5-минутен
// прозорец. Така позволяваме легитимни повторни recovery-та (Mac често
// убива connections агресивно, потребителят може да удари timeout
// многократно), но избягваме tight loop при истински upstream проблем.
// NB: тук дълго пишеше „30s / 3 reload-а" — числата в коментара бяха
// изостанали от константите отдолу. Чете се кодът, не текстът.
const RELOAD_MIN_INTERVAL_MS = 5_000
const RELOAD_BURST_WINDOW_MS = 5 * 60_000
const RELOAD_BURST_MAX = 4
const RELOAD_HISTORY_KEY = 'auth-recovery-history'

function readHistory(): number[] {
  try {
    const raw = sessionStorage.getItem(RELOAD_HISTORY_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(t => typeof t === 'number') : []
  } catch {
    return []
  }
}

/**
 * Опитва soft reload със smart backoff:
 *  - не reload-ва, ако последният е бил < 5s назад
 *  - не reload-ва, ако вече сме направили 4 reload-а за последните 5 мин
 *
 * При истински upstream проблем (Supabase down) → max 4 reload-а в 5 мин
 * → след това приема, че няма какво да направим и спира.
 *
 * ВРЪЩА дали презареждането е ТРЪГНАЛО. Нужно е на екрана за грешка: при
 * спрян от guard-а reload той трябва да покаже бутон, вместо да обещава
 * презареждане, което няма да стане.
 */
export function attemptAutoReload(reason: string): boolean {
  const now = Date.now()
  const history = readHistory().filter(t => now - t < RELOAD_BURST_WINDOW_MS)

  if (history.length > 0) {
    const last = history[history.length - 1]
    if (now - last < RELOAD_MIN_INTERVAL_MS) {
      console.warn(`[recovery] min-interval (5s) активен — пропускам (${reason})`)
      return false
    }
  }
  if (history.length >= RELOAD_BURST_MAX) {
    console.warn(
      `[recovery] burst max (${RELOAD_BURST_MAX}/5мин) достигнат — пропускам, ` +
      `upstream проблем вероятно (${reason})`,
    )
    return false
  }

  history.push(now)
  try { sessionStorage.setItem(RELOAD_HISTORY_KEY, JSON.stringify(history)) } catch { /* ignore */ }
  console.warn(`[recovery] soft reload → ${reason} (reload #${history.length}/${RELOAD_BURST_MAX})`)
  window.location.reload()
  return true
}
