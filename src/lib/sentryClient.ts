/**
 * Тънката обвивка около Sentry SDK-то.
 *
 * ЗАЩО е отделен файл: тук импортите са СТАТИЧНИ и ПОИМЕННО изброени, за да
 * може Rollup да отреже неползваното. Ако вземем целия namespace
 * (`import('@sentry/react')` и после `S.init(...)`), bundler-ът няма как да
 * разбере кое ползваме и качва всичко — Replay, Feedback, tracing, profiling.
 * Измерено: 150 kB gzip срещу нужните ни ~30.
 *
 * Изключените интеграции НЕ са изброени и затова изобщо не влизат в bundle-а —
 * за разлика от филтриране на defaults по време на изпълнение, което ги маха
 * от работата, но не и от файла.
 *
 * Файлът се зарежда динамично от monitoring.ts, само когато има DSN.
 */
import {
  init,
  captureException,
  dedupeIntegration,
  functionToStringIntegration,
  globalHandlersIntegration,
  inboundFiltersIntegration,
  linkedErrorsIntegration,
  breadcrumbsIntegration,
  type ErrorEvent,
  type Breadcrumb,
} from '@sentry/react'

export interface StartOptions {
  dsn: string
  release: string
  environment: string
  redact: (text: string) => string
  stripQuery: (url: string) => string
}

export function start(opts: StartOptions) {
  const { redact, stripQuery } = opts
  init({
    dsn: opts.dsn,
    release: opts.release,
    environment: opts.environment,
    sendDefaultPii: false,
    // Изричен списък вместо defaults: каквото не е тук, не влиза в bundle-а.
    integrations: [
      inboundFiltersIntegration(),
      functionToStringIntegration(),
      dedupeIntegration(),
      linkedErrorsIntegration(),
      globalHandlersIntegration(),
      // Мрежови и навигационни трохи — БЕЗ конзолата и БЕЗ DOM събития:
      // приложението логва данни в конзолата, а кликовете носят текст от екрана.
      breadcrumbsIntegration({ console: false, dom: false, xhr: true, fetch: true, history: true }),
    ],
    beforeBreadcrumb(crumb: Breadcrumb) {
      if (crumb.data?.url) crumb.data.url = stripQuery(String(crumb.data.url))
      if (crumb.message) crumb.message = redact(crumb.message)
      return crumb
    },
    beforeSend(event: ErrorEvent) {
      if (event.message) event.message = redact(event.message)
      for (const ex of event.exception?.values ?? []) {
        if (ex.value) ex.value = redact(ex.value)
      }
      if (event.request?.url) event.request.url = stripQuery(event.request.url)
      return event
    },
  })
}

export function capture(err: unknown, context?: Record<string, unknown>) {
  captureException(err, context ? { extra: context } : undefined)
}
