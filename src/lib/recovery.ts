// Споделено auto-recovery: при детекция на „забит" клиент → soft reload.
//
// Защо отделен модул: trigger-ите идват от различни места (visibility
// handler в AuthProvider, withRetry в storage.ts, потенциално други) и
// всички трябва да споделят един backoff guard, за да не loop-ват.

// Двоен guard: минимум 30s между reload-и + max 3 reload-а в 5-минутен
// прозорец. Така позволяваме легитимни повторни recovery-та (Mac често
// убива connections агресивно, потребителят може да удари timeout
// многократно), но избягваме tight loop при истински upstream проблем.
const RELOAD_MIN_INTERVAL_MS = 30_000
const RELOAD_BURST_WINDOW_MS = 5 * 60_000
const RELOAD_BURST_MAX = 3
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
 *  - не reload-ва, ако последният е бил < 30s назад
 *  - не reload-ва, ако вече сме направили 3 reload-а за последните 5 мин
 *
 * При истински upstream проблем (Supabase down) → max 3 reload-а в 5 мин
 * → след това приема, че няма какво да направим и спира.
 */
export function attemptAutoReload(reason: string): void {
  const now = Date.now()
  const history = readHistory().filter(t => now - t < RELOAD_BURST_WINDOW_MS)

  if (history.length > 0) {
    const last = history[history.length - 1]
    if (now - last < RELOAD_MIN_INTERVAL_MS) {
      console.warn(`[recovery] min-interval (30s) активен — пропускам (${reason})`)
      return
    }
  }
  if (history.length >= RELOAD_BURST_MAX) {
    console.warn(
      `[recovery] burst max (${RELOAD_BURST_MAX}/5мин) достигнат — пропускам, ` +
      `upstream проблем вероятно (${reason})`,
    )
    return
  }

  history.push(now)
  try { sessionStorage.setItem(RELOAD_HISTORY_KEY, JSON.stringify(history)) } catch { /* ignore */ }
  console.warn(`[recovery] soft reload → ${reason} (reload #${history.length}/${RELOAD_BURST_MAX})`)
  window.location.reload()
}
