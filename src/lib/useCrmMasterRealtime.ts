import { useEffect, useRef } from 'react'
import { setRealtimeHealthy } from './realtimeHealth'
import { useRealtime } from './useRealtime'
import { useInvalidateCrm } from './queries'

/**
 * ЕДИН споделен абонамент за мастър таблиците (клиенти + клетки).
 *
 * Защо е тук, а не по страници: същият абонамент стоеше преписан в Работен
 * лист, ТРЗ, Чек лист, Годишен изглед и Профили — пет еднакви канала, активни
 * само докато си на съответната страница. Останалите 12 страници, които четат
 * същите данни (Клиенти, Плащания, Съобщения, Договори…), не научаваха за
 * чужда промяна изобщо и чакаха 5-минутния staleTime.
 *
 * Сега стои в Layout → активен е винаги. Затова и staleTime на тези заявки е
 * вдигнат: няма смисъл да се презарежда „за всеки случай" на всеки 5 минути,
 * когато реалната промяна идва като събитие.
 *
 * ЗАЩИТА НА РЕДАКЦИЯТА: страница, в която се пише, регистрира guard чрез
 * useRefreshGuard(). Докато той връща true, презареждането се отлага — иначе
 * свежите данни биха презаписали полето изпод ръцете на колегата. Пази се
 * поведението, което страниците имаха през shouldDefer.
 */
const guards = new Set<() => boolean>()

/**
 * Докато `isEditing()` връща true, споделеното презареждане се отлага.
 * Guard-ът се маха автоматично при unmount на страницата.
 */
export function useRefreshGuard(isEditing: () => boolean) {
  // Страниците подават нова функция на всеки рендер. Регистрира се стабилна
  // обвивка веднъж, а тя чете последната версия през ref — иначе Set-ът щеше
  // да се пренарежда при всяко рисуване.
  const ref = useRef(isEditing)
  ref.current = isEditing
  useEffect(() => {
    const guard = () => ref.current()
    guards.add(guard)
    return () => { guards.delete(guard) }
  }, [])
}

export function useCrmMasterRealtime() {
  const {
    invalidateClients, invalidateCells, invalidateColumns, invalidateDropdowns,
  } = useInvalidateCrm()

  const refreshAll = () => {
    invalidateClients()
    invalidateCells()
    invalidateColumns()
    invalidateDropdowns()
  }
  const refreshRef = useRef(refreshAll)
  refreshRef.current = refreshAll

  // Първото SUBSCRIBED е нормалното вдигане. Всяко следващо значи, че
  // връзката е падала и се е върнала — а събитията от прекъсването са
  // загубени завинаги. Затова тогава се пречита всичко.
  const wasSubscribed = useRef(false)

  useRealtime({
    channel: 'crm-master',
    tables: ['crm_cell_values', 'crm_clients'],
    onChange: () => refreshRef.current(),
    onStatus: status => {
      if (status === 'SUBSCRIBED') {
        setRealtimeHealthy(true)
        if (wasSubscribed.current) refreshRef.current()  // наваксваме пропуснатото
        wasSubscribed.current = true
      } else {
        // CHANNEL_ERROR / TIMED_OUT / CLOSED — от този момент кешът не бива
        // да се доверява на абонамента и се връща към 5-минутното поведение.
        setRealtimeHealthy(false)
      }
    },
    shouldDefer: () => {
      for (const g of guards) if (g()) return true
      return false
    },
    // По-дълъг debounce от подразбирания 1200ms НАРОЧНО.
    //
    // Абонаментът вече е активен на всичките 17 страници, които четат клетки,
    // а не само на петте с редакция. Значи буря от чужди редакции стига до
    // повече хора — а презареждането тегли най-тежката заявка в приложението.
    // 5 секунди събират бурята в едно теглене и пак се усещат като „веднага".
    debounceMs: 5000,
  })
}
