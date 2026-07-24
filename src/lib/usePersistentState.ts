import { useEffect, useState } from 'react'

// ============================================================
// usePersistentState — useState, който оцелява навигация и reload.
//
// Проблемът: филтрите на страниците са компонентен state → нулират се
// при всяка навигация, а защитният auto-reload (recovery.ts) губи всичко.
// Решението: sessionStorage (per таб) — помни се докато табът е отворен,
// но не „залепва" за вечни времена като localStorage.
//
// Ползване: const [search, setSearch] = usePersistentState('ws-search', '')
// Стойността трябва да е JSON-сериализуема. Set/Map НЕ стават директно.
// ============================================================

export function usePersistentState<T>(key: string, initial: T) {
  const storageKey = `filters:${key}`
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey)
      return raw != null ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value))
    } catch { /* quota/private mode — филтърът просто няма да се помни */ }
  }, [storageKey, value])

  return [value, setValue] as const
}
