import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolveBuildId } from './src/lib/buildId'

// Base path — зависи от хостинг таргета:
//   • GitHub Pages: kd-macbot.github.io/consultplus-crm/ → нужен е „/consultplus-crm/"
//   • Cloudflare Pages: consultplus-crm.pages.dev/ → нужен е „/"
// CF_PAGES=1 се сетва автоматично от Cloudflare build environment.
const base = process.env.CF_PAGES === '1' ? '/' : '/consultplus-crm/'

// Идентификатор на билда — ОТ СРЕДАТА НА БИЛДА, не от панела на хостинга.
// Cloudflare подава CF_PAGES_COMMIT_SHA, както подава CF_PAGES по-горе.
//
// ЗАЩО НЕ ПРЕЗ ПРОМЕНЛИВА В ПАНЕЛА (научено на 14.10.2026, три опита):
// стойностите там се взимат БУКВАЛНО — нито „${CF_PAGES_COMMIT_SHA}", нито
// „CF_PAGES_COMMIT_SHA" се разширяват. Резултатът е константа, която изглежда
// като идентификатор, а busterът на кеша спира да се сменя. Провалът е
// БЕЗШУМЕН: нищо не се чупи видимо. Затова решението е тук, в кода, а
// `resolveBuildId` изрично отхвърля незаместен шаблон.
const BUILD_ID = resolveBuildId(process.env)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Флагове за отрязване на неползваното от Sentry SDK-то. Без тях кодът на
  // Replay и tracing се качва, макар да не са включени — измерено: 150 kB
  // gzip вместо нужните ~30.
  define: {
    // Виж BUILD_ID по-горе. Ползва се на три места: логът при старт, `release`
    // в Sentry и `CACHE_BUSTER` на запазения React Query кеш.
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __SENTRY_DEBUG__: false,
    __SENTRY_TRACING__: false,
    __RRWEB_EXCLUDE_IFRAME__: true,
    __RRWEB_EXCLUDE_SHADOW_DOM__: true,
    __SENTRY_EXCLUDE_REPLAY_WORKER__: true,
  },
  base,
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
