// Saved table views in localStorage.
// Един view = списък със скрити колони + флаг за default.
// Без DB sync — per-browser, per-user. Лесно за мигриране към DB по-късно.

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
