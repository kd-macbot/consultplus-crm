// ============================================================
// Чернова на форма, която ПРЕЖИВЯВА презареждане на страницата.
//
// ЗАЩО СЪЩЕСТВУВА: записът минава през `trackSave`, а той при застояла
// HTTP връзка (дълго отворен таб, заспал компютър) не чака безкрай, а
// презарежда страницата — само свежа връзка лекува проблема. Презареждането
// обаче изтрива написаното в модала и колегата пише всичко наново. Точно
// това се оплакваше при Задачи и Новини.
//
// Механизмът е взет от Банков достъп, където работи отдавна. Изнесен е тук,
// защото вече е на три места, а копие номер три е моментът да спре да се
// преписва. (Банков достъп е оставен със своята реализация — работи и пипа
// пароли; мигрира се само ако го налага друга причина.)
//
// sessionStorage, НЕ localStorage: черновата е за ТОЗИ таб и ТАЗИ сесия.
// В localStorage щеше да изскача след дни, в друг таб, при друг колега на
// същия компютър.
// ============================================================

export interface SimpleStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface DraftStore<T> {
  /** Запазената чернова, или null (няма такава / повредена / няма storage). */
  read(): Partial<T> | null
  write(value: T): void
  clear(): void
  /** Има ли чернова с РЕАЛНО попълнени полета — празната не отваря модал. */
  hasContent(): boolean
}

function defaultStorage(): SimpleStorage | null {
  try {
    if (typeof sessionStorage === 'undefined') return null
    return sessionStorage
  } catch {
    // Блокирани бисквитки/storage (частен прозорец, корпоративна политика).
    return null
  }
}

/**
 * `isFilled` решава кое е „празна чернова". Подава се отвън, защото всяка
 * форма има различни полета по подразбиране: статусът на задача е 'todo' и
 * сам по себе си не значи, че човекът е писал нещо.
 *
 * ВСЯКА операция е в try/catch: storage-ът може да липсва, да е пълен или
 * да хвърля. Чернова, която чупи формата, е по-лошо от липсваща чернова.
 */
export function makeDraftStore<T extends object>(
  key: string,
  isFilled: (draft: Partial<T>) => boolean,
  storage: SimpleStorage | null = defaultStorage(),
): DraftStore<T> {
  return {
    read() {
      if (!storage) return null
      try {
        const raw = storage.getItem(key)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        // Пазим се от чужд/стар запис под същия ключ.
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
        return parsed as Partial<T>
      } catch {
        return null
      }
    },
    write(value: T) {
      if (!storage) return
      try {
        storage.setItem(key, JSON.stringify(value))
      } catch {
        /* quota / блокиран storage — черновата е удобство, не задължение */
      }
    },
    clear() {
      if (!storage) return
      try { storage.removeItem(key) } catch { /* noop */ }
    },
    hasContent() {
      const d = this.read()
      if (!d) return false
      try {
        return isFilled(d)
      } catch {
        return false
      }
    },
  }
}
