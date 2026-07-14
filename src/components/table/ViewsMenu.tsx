import { useState, useRef, useEffect } from 'react'
import { Layout, Star, Trash2, Plus, Check } from 'lucide-react'
import type { View } from '../../lib/views'

interface Props {
  views: View[]
  activeViewId: string | null
  isDirty: boolean
  onSelect: (id: string) => void
  onSaveAs: (name: string) => void
  onUpdate: (id: string) => void
  onDelete: (id: string) => void
  onSetDefault: (id: string) => void
}

export function ViewsMenu({
  views, activeViewId, isDirty, onSelect, onSaveAs, onUpdate, onDelete, onSetDefault,
}: Props) {
  const [open, setOpen] = useState(false)
  const [namingNew, setNamingNew] = useState(false)
  const [newName, setNewName] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  const activeView = views.find(v => v.id === activeViewId) ?? null
  const canUpdateActive = activeView && !activeView.isPreset && isDirty

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
        setNamingNew(false)
        setNewName('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function handleSaveNew() {
    const name = newName.trim()
    if (!name) return
    onSaveAs(name)
    setNamingNew(false)
    setNewName('')
    setOpen(false)
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Изгледи"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border transition ${
          open
            ? 'border-navy bg-navy text-white'
            : 'border-light text-dark/70 hover:border-navy hover:text-navy dark:text-foreground bg-card'
        }`}
      >
        <Layout className="h-3.5 w-3.5" />
        <span className="hidden sm:inline max-w-[140px] truncate">{activeView?.name ?? 'Изглед'}</span>
        {isDirty && <span className="text-amber-500" title="Има незапазени промени">•</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-xl p-1 min-w-[240px]">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-2 pb-1 pt-1 font-semibold">
            Изгледи
          </p>
          {views.map(v => {
            const isActive = v.id === activeViewId
            return (
              <div
                key={v.id}
                className={`flex items-center gap-1 px-1 py-1 rounded text-sm ${isActive ? 'bg-muted' : 'hover:bg-muted/50'}`}
              >
                <button
                  onClick={() => { onSelect(v.id); setOpen(false) }}
                  className="flex-1 text-left px-1 truncate"
                >
                  {isActive && <Check className="h-3 w-3 inline mr-1 text-emerald-600" />}
                  {v.name}
                  {v.isPreset && <span className="ml-1 text-[10px] text-muted-foreground">(преден.)</span>}
                </button>
                <button
                  onClick={() => onSetDefault(v.id)}
                  title={v.isDefault ? 'По подразбиране' : 'Направи по подразбиране'}
                  className="p-1 rounded hover:bg-background"
                >
                  <Star
                    className={`h-3 w-3 ${v.isDefault ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'}`}
                  />
                </button>
                {!v.isPreset && (
                  <button
                    onClick={() => {
                      if (confirm(`Изтрий изглед „${v.name}"?`)) onDelete(v.id)
                    }}
                    title="Изтрий"
                    className="p-1 rounded hover:bg-background"
                  >
                    <Trash2 className="h-3 w-3 text-red-500/70" />
                  </button>
                )}
              </div>
            )
          })}

          <div className="border-t border-border mt-1 pt-1 space-y-0.5">
            {canUpdateActive && (
              <button
                onClick={() => { onUpdate(activeView!.id); setOpen(false) }}
                className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted text-foreground"
              >
                💾 Обнови „{activeView!.name}" с текущите промени
              </button>
            )}

            {namingNew ? (
              <div className="flex gap-1 px-2 py-1.5">
                <input
                  autoFocus
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveNew()
                    if (e.key === 'Escape') { setNamingNew(false); setNewName('') }
                  }}
                  placeholder="Име на изгледа"
                  className="flex-1 px-2 py-1 text-xs border border-border rounded bg-background"
                />
                <button onClick={handleSaveNew} className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90">
                  OK
                </button>
              </div>
            ) : (
              <button
                onClick={() => setNamingNew(true)}
                className="w-full flex items-center gap-1.5 text-xs px-2 py-1.5 rounded hover:bg-muted text-foreground"
              >
                <Plus className="h-3 w-3" />
                Запази текущия като нов...
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
