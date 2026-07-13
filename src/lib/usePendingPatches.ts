import { useCallback, useEffect, useRef, useState } from 'react'

// ============================================================
// usePendingPatches — durable pending слой за записи.
//
// Проблемът, който решава (същият като на Личен чек лист):
//   1. Потребителят прави промяна → оптимистичен update → запис
//   2. Записът увисва (stale връзка след idle таб) или фейлва
//   3. Старият код invalidate-ваше → refetch → промяната „изчезва"
//   4. Или auto-reload-ът (trackSave) презарежда → оптимистичното се губи
//
// Решението: всяка промяна се пази в localStorage (per ключ на екрана,
// напр. месец), наслагва се ОТГОРЕ на данните от сървъра при render и
// се маха чак когато записът реално е потвърден. flush() опитва да
// запише чакащите при mount (след reload) и при връщане на видимост.
//
// Ключовете са string — може да е clientId или композитен
// (`${clientId}|${type}|${month}`), стига save() да знае как да го парсне.
// ============================================================

type PatchMap<T> = Map<string, Partial<T>>

function readStore<T>(storageKey: string): PatchMap<T> {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return new Map()
    return new Map(Object.entries(JSON.parse(raw) as Record<string, Partial<T>>))
  } catch {
    return new Map()
  }
}

function writeStore<T>(storageKey: string, map: PatchMap<T>) {
  try {
    if (map.size === 0) localStorage.removeItem(storageKey)
    else localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(map)))
  } catch { /* quota — pending-ът просто няма да оцелее reload */ }
}

export function usePendingPatches<T>(opts: {
  /** Уникален ключ per екран+период, напр. `trz-pending-2026-6`. */
  storageKey: string
  /** Записва един patch. Хвърля при неуспех (patch-ът остава pending). */
  save: (key: string, patch: Partial<T>) => Promise<void>
  /** Извиква се след успешен flush на поне един запис (напр. invalidate). */
  onFlushed?: () => void
}) {
  const { storageKey, save, onFlushed } = opts

  const [pending, setPending] = useState<PatchMap<T>>(() => readStore<T>(storageKey))

  // Смяна на периода (нов storageKey) → hydrate за новия.
  useEffect(() => { setPending(readStore<T>(storageKey)) }, [storageKey])
  // Persist при всяка промяна.
  useEffect(() => { writeStore(storageKey, pending) }, [storageKey, pending])

  // Ref за най-новото pending — listener-ите да не четат stale стойност.
  const pendingRef = useRef(pending)
  useEffect(() => { pendingRef.current = pending }, [pending])

  const saveRef = useRef(save)
  useEffect(() => { saveRef.current = save }, [save])
  const onFlushedRef = useRef(onFlushed)
  useEffect(() => { onFlushedRef.current = onFlushed }, [onFlushed])

  /** Добавя patch към pending (merge върху съществуващия за същия ключ). */
  const addPatch = useCallback((key: string, patch: Partial<T>) => {
    setPending(prev => {
      const next = new Map(prev)
      next.set(key, { ...(next.get(key) ?? {}), ...patch })
      return next
    })
  }, [])

  /** Маха конкретни полета от pending на даден ключ (при потвърден запис). */
  const removeFields = useCallback((key: string, fields: string[]) => {
    setPending(prev => {
      const next = new Map(prev)
      const existing = { ...(next.get(key) ?? {}) } as Record<string, unknown>
      fields.forEach(f => delete existing[f])
      if (Object.keys(existing).length === 0) next.delete(key)
      else next.set(key, existing as Partial<T>)
      return next
    })
  }, [])

  // Retry на чакащите — последователно, с guard срещу паралелни flush-ове.
  const flushingRef = useRef(false)
  const flush = useCallback(async () => {
    if (flushingRef.current) return
    const snapshot = new Map(pendingRef.current)
    if (snapshot.size === 0) return
    flushingRef.current = true
    let flushed = 0
    try {
      for (const [key, patch] of snapshot) {
        try {
          await saveRef.current(key, patch)
          // Махаме само полетата от snapshot-а — нови промени, добавени
          // по време на flush-а, остават.
          removeFields(key, Object.keys(patch))
          flushed++
        } catch { /* остава pending за следващ опит */ }
      }
    } finally {
      flushingRef.current = false
      if (flushed > 0) onFlushedRef.current?.()
    }
  }, [removeFields])

  // Опит при mount (напр. след auto-reload) и при връщане на видимост.
  useEffect(() => {
    void flush()
    const onVis = () => { if (document.visibilityState === 'visible') void flush() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [flush, storageKey])

  return { pending, addPatch, removeFields, flush }
}
