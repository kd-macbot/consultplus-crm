import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

interface RealtimeOptions {
  /** Уникално име на канала за тази страница (напр. "worksheet"). */
  channel: string
  /** Таблици за слушане (public schema). */
  tables: string[]
  /** Викa се (debounced) при промяна. Обикновено тихо презареждане. */
  onChange: () => void
  enabled?: boolean
  /** Изчаква буря от събития преди да презареди. По подразбиране 1200ms. */
  debounceMs?: number
  /**
   * Ако върне true, презареждането се отлага (напр. потребителят активно
   * редактира — не искаме да му презапишем полето изпод ръцете). Проверява се
   * пак след debounceMs.
   */
  shouldDefer?: () => boolean
}

/**
 * Слуша Supabase Realtime за промени по подадените таблици и вика onChange
 * (debounced). Така промени от колеги се отразяват без ръчен refresh.
 */
export function useRealtime({ channel, tables, onChange, enabled = true, debounceMs = 1200, shouldDefer }: RealtimeOptions) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const deferRef = useRef(shouldDefer)
  deferRef.current = shouldDefer

  const tablesKey = tables.join(',')

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null

    const trigger = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (deferRef.current?.()) {
          // Потребителят още редактира — пробвай пак след малко.
          trigger()
          return
        }
        onChangeRef.current()
      }, debounceMs)
    }

    const ch = supabase.channel(`rt-${channel}`)
    for (const table of tables) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, trigger)
    }
    ch.subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, tablesKey, enabled, debounceMs])
}
