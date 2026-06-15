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
  base,
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
