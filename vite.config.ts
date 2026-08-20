import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Base path — зависи от хостинг таргета:
//   • GitHub Pages: kd-macbot.github.io/consultplus-crm/ → нужен е „/consultplus-crm/"
//   • Cloudflare Pages: consultplus-crm.pages.dev/ → нужен е „/"
// CF_PAGES=1 се сетва автоматично от Cloudflare build environment.
const base = process.env.CF_PAGES === '1' ? '/' : '/consultplus-crm/'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Флагове за отрязване на неползваното от Sentry SDK-то. Без тях кодът на
  // Replay и tracing се качва, макар да не са включени — измерено: 150 kB
  // gzip вместо нужните ~30.
  define: {
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
