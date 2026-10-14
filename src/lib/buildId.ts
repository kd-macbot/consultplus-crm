// Идентификаторът на билда — чете се ПРИ БИЛДА (vite.config.ts), не в браузъра.
//
// ЗАЩО СЪЩЕСТВУВА ОТДЕЛЕН ФАЙЛ: стойността се ползва на три места (логът при
// старт, `release` в Sentry и `CACHE_BUSTER` на запазения React Query кеш) и
// сбърка ли се, НИЩО не се чупи видимо — просто кешът спира да се чисти при
// деплой, а грешките в Sentry не казват от кой билд са. Тиха грешка с цена,
// тоест място за тест.

/**
 * `${CF_PAGES_COMMIT_SHA}` и подобни НЕ са идентификатори, а симптом: някой е
 * написал заместител в настройките на хостинга, а те не разширяват `${...}`
 * и го записват буквално.
 *
 * Открито на 14.10.2026: променливата беше въведена в панела на Cloudflare
 * точно така и busterът стана низа `${CF_PAGES_COMMIT_SHA}` — константа, като
 * предишната. Изглеждаше направено и мълчеше, че не работи.
 */
export function looksUnexpanded(value: string): boolean {
  return value.includes('${')
}

/**
 * Редът е нарочен: ръчно зададена стойност бие автоматичната, а в края стои
 * 'dev' — локално и при непознат хостинг няма друго разумно.
 *
 * `CF_PAGES_COMMIT_SHA` се подава от Cloudflare в средата на БИЛДА (както
 * `CF_PAGES`, по което се реши base path-ът), тоест не иска нищо в панела.
 */
export function resolveBuildId(env: Record<string, string | undefined>): string {
  for (const key of ['VITE_BUILD_ID', 'CF_PAGES_COMMIT_SHA']) {
    const raw = env[key]
    if (!raw) continue
    const value = raw.trim()
    if (!value || looksUnexpanded(value)) continue
    return value
  }
  return 'dev'
}
