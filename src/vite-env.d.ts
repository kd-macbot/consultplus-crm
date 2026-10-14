/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_DEV_ENV?: string
  /** Празно = мониторингът е изключен. Вземи го от ЕС региона на Sentry. */
  readonly VITE_SENTRY_DSN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/**
 * Идентификаторът на билда, зашит при компилация от `vite.config.ts`
 * (`resolveBuildId`). НЕ е `import.meta.env.VITE_BUILD_ID` нарочно —
 * стойността идва от средата на билда, а не от панела на хостинга, където
 * се взима буквално и се проваля безшумно.
 */
declare const __BUILD_ID__: string
