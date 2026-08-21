/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_BUILD_ID?: string
  readonly VITE_DEV_ENV?: string
  /** Празно = мониторингът е изключен. Вземи го от ЕС региона на Sentry. */
  readonly VITE_SENTRY_DSN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
