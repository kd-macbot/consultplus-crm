// Лек helper за измерване на времена при зареждане. Логва в конзолата с
// префикс [perf] — отвори DevTools → Console и презареди, за да видиш кое
// колко трае (auth, заявки към базата, брой върнати редове).
//
// Това е временно диагностично средство — маха се след като намерим тясното
// място.

const LABEL_STYLE = 'color:#b8860b;font-weight:bold'

export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now()
  try {
    const result = await fn()
    const ms = Math.round(performance.now() - t0)
    const extra = Array.isArray(result) ? ` — ${result.length} реда` : ''
    console.info(`%c[perf]%c ${label}: ${ms}ms${extra}`, LABEL_STYLE, 'color:inherit')
    return result
  } catch (e) {
    const ms = Math.round(performance.now() - t0)
    console.warn(`%c[perf]%c ${label}: ГРЕШКА след ${ms}ms`, LABEL_STYLE, 'color:inherit')
    throw e
  }
}
