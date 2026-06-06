// Saved table views.
// Един view = списък със скрити колони + флаг за default.
//
// Хибридно съхранение:
//  - localStorage = мигновен кеш (синхронен API, без забавяне на UI).
//  - Supabase (crm_user_views) = източник на истина, вързан за акаунта →
//    изгледите следват потребителя между устройства.
// При вход се извиква syncViewsFromDb(): тегли от DB и презаписва кеша.
// Всяка мутация пише локално веднага + push към DB (fire-and-forget).

import { getUserViews, saveUserViews } from './storage'

export interface View {
  id: string
  name: string
  hiddenCols: string[]
  isDefault: boolean
  isPreset?: boolean
}

const STORAGE_KEY = 'crm-views'
const LEGACY_HIDDEN_COLS_KEY = 'crm-hidden-cols'

const DEFAULT_PRESETS: View[] = [
  { id: 'preset-all', name: 'Всичко', hiddenCols: [], isDefault: true, isPreset: true },
]

interface Store {
  views: View[]
  activeId: string | null
  ownerId?: string  // user_id, на който принадлежи този локален кеш
}

function migrateLegacy(): Store {
  // Ако имаме стария ключ crm-hidden-cols → правим един initial saved view от него
  try {
    const legacy = localStorage.getItem(LEGACY_HIDDEN_COLS_KEY)
    if (legacy) {
      const hidden = JSON.parse(legacy) as string[]
      if (Array.isArray(hidden) && hidden.length > 0) {
        const view: View = {
          id: 'view-legacy',
          name: 'Запазен изглед',
          hiddenCols: hidden,
          isDefault: true,
        }
        return {
          views: [...DEFAULT_PRESETS.map(p => ({ ...p, isDefault: false })), view],
          activeId: view.id,
        }
      }
    }
  } catch { /* ignore */ }
  return { views: DEFAULT_PRESETS, activeId: 'preset-all' }
}

function load(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Store
      if (Array.isArray(parsed.views) && parsed.views.length > 0) return parsed
    }
  } catch { /* ignore */ }
  const initial = migrateLegacy()
  persist(initial)
  return initial
}

function persist(store: Store): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  // Push към DB (fire-and-forget) — UI не чака. Грешка не блокира работата;
  // localStorage остава като fallback.
  void saveUserViews({ views: store.views, activeId: store.activeId }).catch(() => {
    /* офлайн/без права — изгледът остава локален */
  })
}

/**
 * Синхронизира изгледите от DB в localStorage. Викай веднъж при вход —
 * така изгледите, създадени на друго устройство, се появяват тук.
 * `userId` се ползва, за да не „наследим" чужди локални изгледи на
 * споделен компютър. Връща true ако кешът е променен (за да се пресвежи UI).
 */
export async function syncViewsFromDb(userId: string): Promise<boolean> {
  try {
    const remote = await getUserViews()
    if (remote) {
      // DB е източникът на истина — презаписваме локалния кеш (без повторен push).
      const store: Store = {
        views: remote.views as View[],
        activeId: remote.activeId,
        ownerId: userId,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
      return true
    }

    // Няма DB ред за този потребител.
    const local = load()
    const localBelongsToUser = !local.ownerId || local.ownerId === userId

    if (localBelongsToUser && local.views.some(v => !v.isPreset)) {
      // Легитимна миграция: локални изгледи на ТОЗИ потребител → качваме ги.
      await saveUserViews({ views: local.views, activeId: local.activeId })
      const store: Store = { ...local, ownerId: userId }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
      return false
    }

    if (!localBelongsToUser) {
      // Споделен компютър: кешът е на друг потребител → не го наследяваме,
      // не го качваме. Ресетваме до presets за текущия потребител.
      const store: Store = { views: DEFAULT_PRESETS, activeId: 'preset-all', ownerId: userId }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
      return true
    }

    // Чист първи вход без изгледи — само маркираме собственика.
    const store: Store = { ...local, ownerId: userId }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    return false
  } catch {
    // Без мрежа/права — оставаме на локалния кеш.
    return false
  }
}

/** Чисти локалния кеш на изгледите (викай при изход). */
export function clearViewsCache(): void {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

export function getViews(): View[] {
  return load().views
}

export function getActiveViewId(): string | null {
  return load().activeId
}

export function setActiveViewId(id: string | null): void {
  const s = load()
  s.activeId = id
  persist(s)
}

export function getDefaultView(): View | null {
  const s = load()
  return s.views.find(v => v.isDefault) ?? s.views[0] ?? null
}

export function saveView(input: Omit<View, 'id'> & { id?: string }): View {
  const s = load()
  const id = input.id ?? `view-${Date.now()}`
  const idx = s.views.findIndex(v => v.id === id)
  const view: View = { ...input, id }
  if (idx >= 0) s.views[idx] = view
  else s.views.push(view)
  persist(s)
  return view
}

export function deleteView(id: string): void {
  const s = load()
  // Preset изгледите не могат да се изтриват
  s.views = s.views.filter(v => v.id !== id || v.isPreset)
  if (s.activeId === id) s.activeId = s.views[0]?.id ?? null
  persist(s)
}

export function setDefaultView(id: string): void {
  const s = load()
  s.views = s.views.map(v => ({ ...v, isDefault: v.id === id }))
  persist(s)
}

export function renameView(id: string, name: string): void {
  const s = load()
  const v = s.views.find(view => view.id === id)
  if (!v || v.isPreset) return
  v.name = name
  persist(s)
}
