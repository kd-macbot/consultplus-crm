import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing Supabase env vars. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in a .env.local file (see .env.example).'
  )
}

// Колко чакаме една HTTP заявка към Supabase, преди да я ОТМЕНИМ. Това е
// ключово против „забива след заспал таб": когато връзката е застояла, auth
// refresh-ът увисва вътре в Web Lock-а (`navigator.locks`) и блокира всяка
// следваща заявка (всяка вика getSession() → чака същия lock). Като отменяме
// заявката, lock-ът се освобождава и следващата заявка минава по свежа връзка.
const REQUEST_TIMEOUT_MS = 10_000
// Edge функциите (swift-task → regdata) са по-бавни, дай им повече време.
const EDGE_TIMEOUT_MS = 30_000

const timeoutFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const timeoutMs = url.includes('/functions/v1/') ? EDGE_TIMEOUT_MS : REQUEST_TIMEOUT_MS

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new DOMException('Заявката изтече (timeout)', 'TimeoutError')),
    timeoutMs,
  )

  // Уважаваме и сигнала на викащия — отменяме при който и да е от двата.
  const caller = init?.signal
  if (caller) {
    if (caller.aborted) controller.abort(caller.reason)
    else caller.addEventListener('abort', () => controller.abort(caller.reason), { once: true })
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

// ============================================================
// Custom auth lock с timeout — коренното решение на „забива след заспал таб".
//
// supabase-js по подразбиране ползва navigator.locks за сериализация на
// token refresh между табове. Проблемът: когато табът се върне от заден
// план, този lock понякога DEADLOCK-ва — държи се от заявка, която никога
// не завършва, и всяка следваща заявка виси, чакайки същия lock (преди дори
// да стигне до fetch, така че fetch timeout-ът не я хваща).
//
// Този lock се опитва да вземе navigator.locks, но ако не успее до
// LOCK_ACQUIRE_TIMEOUT, продължава БЕЗ него. Worst case: два таба правят
// token refresh едновременно (supabase го толерира), вместо целият CRM да
// увисне. За вътрешен инструмент това е правилният компромис.
// ============================================================
const LOCK_ACQUIRE_TIMEOUT_MS = 5_000

async function timeoutLock<R>(
  name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> {
  // Средите без navigator.locks (стари браузъри / SSR) → директно.
  if (typeof navigator === 'undefined' || !navigator.locks?.request) {
    return fn()
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOCK_ACQUIRE_TIMEOUT_MS)
  try {
    return await navigator.locks.request(
      name,
      { signal: controller.signal },
      async () => {
        clearTimeout(timer)
        return fn()
      },
    )
  } catch (err) {
    clearTimeout(timer)
    // Прекъснат при acquire (deadlock/timeout) → изпълни без lock, а не виси.
    if ((err as Error)?.name === 'AbortError') {
      return fn()
    }
    throw err
  }
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    lock: timeoutLock,
  },
  global: { fetch: timeoutFetch },
})
