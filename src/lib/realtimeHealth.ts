import { useSyncExternalStore } from 'react'

/**
 * Жива ли е realtime връзката.
 *
 * ЗАЩО СЪЩЕСТВУВА: мастър заявките са с 30-минутен staleTime, защото
 * свежестта им идва от realtime абонамента, а не от изтичане на кеша. Ако
 * абонаментът умре тихо (заспал лаптоп, паднала мрежа, изтекъл токен), това
 * допускане пада — и колегата би гледал стари данни половин час, без да
 * подозира.
 *
 * Затова състоянието се СЛЕДИ, а не се предполага. Докато връзката не е
 * потвърдена, кешът се държи както преди: 5 минути.
 *
 * Модулна променлива, а не React state: пише се от абонамента (извън рендер),
 * а се чете от заявките. useSyncExternalStore прави промяната видима за
 * компонентите.
 */

let healthy = false
const listeners = new Set<() => void>()

export function setRealtimeHealthy(value: boolean) {
  if (value === healthy) return
  healthy = value
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const getSnapshot = () => healthy

/** Сървърният рендер няма връзка — там винаги е „не е потвърдена". */
const getServerSnapshot = () => false

export function useRealtimeHealthy(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** Само за тестове — превключвателят е твърде важен, за да не е покрит. */
export const __store = { get: getSnapshot, subscribe }
