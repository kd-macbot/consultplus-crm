// Споделено auto-recovery: при детекция на „забит" клиент → soft reload.
//
// Защо отделен модул: trigger-ите идват от различни места (visibility
// handler в AuthProvider, withRetry в storage.ts, потенциално други) и
// всички трябва да споделят един backoff guard, за да не loop-ват.

const RELOAD_BACKOFF_MS = 60_000
const RELOAD_TS_KEY = 'auth-recovery-reload-ts'

/**
 * Опитва soft reload с backoff guard. Безопасно за многократно извикване —
 * втори път в рамките на 60s само логва и излиза.
 */
export function attemptAutoReload(reason: string): void {
  const lastReloadStr = sessionStorage.getItem(RELOAD_TS_KEY)
  const lastReload = lastReloadStr ? parseInt(lastReloadStr, 10) : 0
  if (Date.now() - lastReload < RELOAD_BACKOFF_MS) {
    console.warn(`[recovery] backoff активен — пропускам (${reason})`)
    return
  }
  try { sessionStorage.setItem(RELOAD_TS_KEY, String(Date.now())) } catch { /* ignore */ }
  console.warn(`[recovery] soft reload → ${reason}`)
  window.location.reload()
}
