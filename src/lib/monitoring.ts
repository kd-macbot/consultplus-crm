/**
 * Мониторинг на грешките (Sentry).
 *
 * ЗАЩО: досега, когато при колега гръмне нещо, никой не научаваше — освен ако
 * човекът не се обади. ErrorBoundary показва екран с извинение, но следата
 * остава само в неговата конзола.
 *
 * ═══ ЛИЧНИ ДАННИ ═══
 * Системата работи с РЕАЛНИ данни (имена, ЕГН, телефони, хонорари). Затова:
 *   – НЯМА Session Replay (той записва екрана — тоест самите клиентски данни);
 *   – НЯМА performance tracing (не ни трябва, а мъкне URL-и);
 *   – sendDefaultPii: false → без IP адрес и без самоличност на потребителя;
 *   – всяко съобщение, breadcrumb и URL минава през redact() преди изпращане;
 *   – console breadcrumb-ите са изключени изцяло — приложението логва данни
 *     в конзолата (напр. [perf] редовете) и те нямат работа навън.
 * Изпраща се СТЕКТРЕЙС + вид на грешката, не съдържание на екрана.
 *
 * ═══ КРИТИЧЕН ПЪТ ═══
 * SDK-то е ~30 kB gzip — колкото пета от целия критичен път. Затова се зарежда
 * ДИНАМИЧНО, отделно от първоначалния bundle. Докато се зарежда, простички
 * native handler-и трупат грешките в буфер и ги предават, щом SDK-то е готово.
 * Тоест нищо не се губи, но и нищо не се бави.
 *
 * ═══ ВКЛЮЧВАНЕ ═══
 * Само при наличен VITE_SENTRY_DSN. Без него целият модул е no-op — локалната
 * разработка не праща нищо. DSN-ът е публичен по дизайн (стои в bundle-а).
 * NB: за GDPR вземи DSN от ЕС региона на Sentry (хост ingest.de.sentry.io),
 * не от US.
 */

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined

/** Максимум грешки в буфера, докато SDK-то се зарежда. */
const MAX_PENDING = 20

type SentryClient = typeof import('./sentryClient')

let sentry: SentryClient | null = null
const pending: unknown[] = []

// ---------------------------------------------------------------------------
// Заличаване на лични данни
// ---------------------------------------------------------------------------

/**
 * Маха от текста неща, които приличат на лични данни.
 *
 * Не разчита на това, че грешките „не съдържат данни" — съобщение от Postgres
 * спокойно може да върне стойността на реда, който е счупил constraint.
 */
export function redact(text: string): string {
  return text
    // Първо IBAN — иначе дългите му цифри объркват следващите правила.
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,26}\b/g, '[IBAN]')
    // Телефони с международен код или с разделители (не са 10 слети цифри).
    .replace(/(?:\+|00)359\s?\d[\d\s-]{7,}\d/g, '[телефон]')
    // Изисква поне един разделител ([\s-]) — слетите 10 цифри отиват на
    // правилото по-долу, което ги различава от ЕГН.
    .replace(/\b0[87-9]\d[\d\s-]*[\s-][\d\s-]*\d\b/g, '[телефон]')
    // Десет слети цифри: може да е ЕГН, може да е телефон без разделители —
    // и двете са 10 знака. Разграничаваме по 3-4 позиция: при ЕГН там стои
    // месецът (01-12; +20 за родените преди 1900, +40 за след 2000).
    // 0888123456 → „88" не е месец → телефон.
    // 0841014567 → „41" е месец (2008 г.) → ЕГН.
    // И в двата случая стойността излиза заличена; разликата е само в етикета,
    // но грешен етикет обърква разследването на бъг.
    .replace(/\b\d{10}\b/g, m => {
      const mm = Number(m.slice(2, 4))
      const isMonth = (mm >= 1 && mm <= 12) || (mm >= 21 && mm <= 32) || (mm >= 41 && mm <= 52)
      return isMonth ? '[ЕГН]' : '[телефон]'
    })
    // Имейли
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[имейл]')
}

/** Маха query string-а от URL — там влизат филтри със стойности. */
function stripQuery(url: string): string {
  const cut = url.indexOf('?')
  return redact(cut === -1 ? url : url.slice(0, cut))
}

// ---------------------------------------------------------------------------
// Ранни handler-и: работят, докато SDK-то се зарежда
// ---------------------------------------------------------------------------

function capture(err: unknown) {
  if (sentry) { sentry.capture(err); return }
  if (pending.length < MAX_PENDING) pending.push(err)
}

const onError = (e: ErrorEvent) => capture(e.error ?? e.message)
const onRejection = (e: PromiseRejectionEvent) => capture(e.reason)

/**
 * Изпраща грешка ръчно — за catch блокове, където се възстановяваме, но пак
 * искаме да знаем, че се е случило.
 */
export function captureError(err: unknown, context?: Record<string, unknown>) {
  if (!DSN) return
  if (sentry) sentry.capture(err, context)
  else capture(err)
}

export function initMonitoring() {
  if (!DSN) return   // локално и без конфигурация — не праща нищо

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  // Динамично — SDK-то е ~30 kB gzip и няма работа в критичния път.
  // Импортът е към собствената ни обвивка, а не към '@sentry/react': там
  // импортите са поименни и Rollup може да отреже неползваното.
  import('./sentryClient')
    .then(S => {
      S.start({
        dsn: DSN,
        release: import.meta.env.VITE_BUILD_ID ?? 'dev',
        environment: import.meta.env.VITE_DEV_ENV ? 'dev' : 'production',
        redact,
        stripQuery,
      })

      sentry = S
      // SDK-то си слага собствени глобални handler-и — нашите вече само биха
      // дублирали всяка грешка.
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)

      for (const err of pending.splice(0)) S.capture(err)
    })
    .catch(() => {
      // Sentry не се зареди (blocker, мрежа). Приложението не бива да страда —
      // просто оставаме без мониторинг за тази сесия.
    })
}
