// Разпознаване на „страницата иска парче, което вече го няма".
//
// ЗАЩО СЪЩЕСТВУВА: всичките 26 страници се зареждат с `lazy()`, а
// Cloudflare Pages сервира само ТЕКУЩИЯ деплой. Отворен отпреди таб, който
// навигира след качване на нова версия, иска файл с име от старата
// (`WorkSheet-B_cxqKVn.js`) и получава 404. Видяно в Sentry на 14.10.2026.
//
// ПРОВЕРКАТА Е НАРОЧНО ТЯСНА. Само „Failed to fetch" е обикновена мрежова
// грешка — пада wifi, пада Supabase — и презареждане там не лекува нищо, а
// би въртяло таба на колегата точно когато мрежата е лоша. Затова се искат
// думите за МОДУЛ: те идват единствено от провален динамичен импорт.
//
// Текстовете са различни във всеки браузър и НЕ се нормализират от никого.
const PATTERNS = [
  'failed to fetch dynamically imported module', // Chrome, Edge
  'error loading dynamically imported module',   // Firefox
  'importing a module script failed',            // Safari
  'unable to preload css for',                   // помощникът на Vite за стиловете
]

/** Текстът на грешката, каквато и форма да е дошла. */
function messageOf(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message ?? ''
  if (typeof error === 'object' && 'message' in error) {
    const m = (error as { message?: unknown }).message
    return typeof m === 'string' ? m : ''
  }
  return ''
}

/**
 * Вярно само за провален динамичен импорт (ново качване, докато табът е
 * отворен). Лекува се с презареждане — свежият index.html сочи новите имена.
 */
export function isChunkLoadError(error: unknown): boolean {
  const msg = messageOf(error).toLowerCase()
  if (!msg) return false
  return PATTERNS.some(p => msg.includes(p))
}
