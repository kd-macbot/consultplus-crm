import { useEffect, useState } from 'react'

/**
 * Видима лента за не-production среди (dev/test).
 *
 * Показва се само когато `VITE_DEV_ENV` е сетнат (true/dev/test) в build-а.
 * Live build от GitHub Actions не задава тази променлива → лентата не се
 * рендерира изобщо (нула риск за production).
 *
 * Цел: да не пишеш по грешка в live базата, мислейки че си в dev.
 */
export function EnvironmentBanner() {
  const [dismissed, setDismissed] = useState(false)
  const envName = ((import.meta.env.VITE_DEV_ENV as string | undefined) ?? '').trim().toLowerCase()
  const isDev = envName && envName !== 'false' && envName !== '0'

  // Hydrate dismissed flag from sessionStorage (за да не дразним при
  // навигация в рамките на същата сесия; връща се при нов tab/refresh).
  useEffect(() => {
    if (!isDev) return
    try {
      if (sessionStorage.getItem('env-banner-dismissed') === '1') setDismissed(true)
    } catch { /* ignore */ }
  }, [isDev])

  if (!isDev || dismissed) return null

  const label = envName === 'test' ? 'ТЕСТ СРЕДА' : 'DEV СРЕДА'

  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-500 text-amber-950 text-xs font-semibold px-3 py-1.5 shadow-md">
      <span className="uppercase tracking-wider">⚠️ {label}</span>
      <span className="font-normal opacity-80">— промените НЕ са на live базата</span>
      <button
        onClick={() => {
          setDismissed(true)
          try { sessionStorage.setItem('env-banner-dismissed', '1') } catch { /* ignore */ }
        }}
        className="ml-2 px-1.5 py-0.5 rounded hover:bg-amber-600/30 transition-colors"
        aria-label="Скрий"
      >
        ✕
      </button>
    </div>
  )
}
