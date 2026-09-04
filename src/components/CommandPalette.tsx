import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, CornerDownLeft, Building2 } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useMyStaff } from '../lib/useMyStaff'
import { useClients, useColumns, useCellValues } from '../lib/queries'
import { buildCellIndex, clientDisplayName } from '../lib/tableIndices'
import { visibleNavItems, NAV_SECTIONS, type NavItem } from '../lib/nav'
import { rankCommands, type CommandEntry } from '../lib/commandPalette'

// ============================================================
// Бързо търсене (Ctrl+K / ⌘K) — скачане на страница или фирма.
//
// Стои в Layout, тоест работи на всяка страница. Фирмите идват от вече
// заредения мастър кеш (React Query) — търсенето НЕ прави своя заявка.
//
// ПРАВАТА не се преписват тук: списъкът със страници минава през
// `visibleNavItems` — същата функция, която пълни и sidebar-а.
// ============================================================

/** Секцията на страницата — за втория ред („Ежедневна работа"). */
const SECTION_OF = new Map<string, string>(
  NAV_SECTIONS.flatMap(s => s.items.map(i => [i.to, s.title ?? 'Начало'] as const)),
)

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const { user } = useAuth()
  const { inDept } = useMyStaff()
  const clientsQ = useClients()
  const columnsQ = useColumns()
  const cellsQ = useCellValues()

  // Ctrl+K / ⌘K отваря, Escape затваря. Слуша се на прозореца, за да работи
  // и когато фокусът е в клетка на таблица.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Всяко отваряне започва на чисто — иначе вчерашната заявка стои и
  // първият Enter отвежда някъде другаде.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  const pages: NavItem[] = useMemo(() => visibleNavItems({
    role: user?.role,
    isTrz: inDept('ТРЗ'),
    canSeeBankAccess: user?.role === 'admin' || inDept('Тийм Лийд') || inDept('Управление'),
    canSeeSpo: user?.role === 'admin' || user?.role === 'manager' || inDept('Счетоводство'),
    canSeeTemplates: user?.role === 'admin' || (user?.role === 'manager' && inDept('Управление')),
  }), [user?.role, inDept])

  const iconOf = useMemo(() => {
    const m = new Map<string, NavItem['icon']>()
    pages.forEach(p => m.set(p.to, p.icon))
    return m
  }, [pages])

  // Имената на фирмите се смятат само докато търсенето е отворено — иначе
  // Layout щеше да прави индекса на всяка страница, без никой да търси.
  const entries: CommandEntry[] = useMemo(() => {
    const pageEntries: CommandEntry[] = pages.map(p => ({
      id: `page:${p.to}`, kind: 'page', label: p.label, hint: SECTION_OF.get(p.to),
    }))
    if (!open) return pageEntries
    const columns = columnsQ.data ?? []
    const cellIdx = buildCellIndex(cellsQ.data ?? [])
    const clientEntries: CommandEntry[] = (clientsQ.data ?? []).map((c): CommandEntry => ({
      id: `client:${c.id}`,
      kind: 'client',
      label: clientDisplayName(c.id, columns, cellIdx),
      hint: 'Клиент',
    })).filter(e => e.label.trim() !== '')
    return [...pageEntries, ...clientEntries]
  }, [open, pages, clientsQ.data, columnsQ.data, cellsQ.data])

  const results = useMemo(() => rankCommands(entries, query), [entries, query])

  // Заявката се сменя → маркерът се връща най-горе, за да не сочи ред,
  // който вече не съществува.
  useEffect(() => { setActive(0) }, [query])

  function run(entry: CommandEntry) {
    setOpen(false)
    if (entry.kind === 'page') {
      navigate(entry.id.slice('page:'.length))
      return
    }
    // Фирмите нямат собствена страница — отваря се таблицата Клиенти с
    // името в търсачката. `q` се чете от DataTable и се маха от адреса.
    navigate(`/clients?q=${encodeURIComponent(entry.label)}`)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const r = results[active]; if (r) run(r) }
  }

  // Маркираният ред да е видим при движение със стрелките.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center p-4 pt-[12vh]"
      onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-xl overflow-hidden border border-border">
        <div className="flex items-center gap-2 px-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Търси страница или фирма..."
            className="flex-1 h-12 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-auto py-1">
          {results.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Няма съвпадение за „{query}"
            </p>
          ) : results.map((r, i) => {
            const Icon = r.kind === 'page' ? (iconOf.get(r.id.slice('page:'.length)) ?? Search) : Building2
            return (
              <button
                key={r.id}
                data-active={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(r)}
                className={`w-full flex items-center gap-3 px-4 py-2 text-left transition ${
                  i === active ? 'bg-accent/60' : 'hover:bg-muted/40'
                }`}
              >
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-foreground truncate">{r.label}</span>
                  {r.hint && <span className="block text-[11px] text-muted-foreground">{r.hint}</span>}
                </span>
                {i === active && <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 border-t border-border text-[11px] text-muted-foreground">
          <span>↑↓ избор</span>
          <span>↵ отвори</span>
          <span className="ml-auto">Ctrl+K</span>
        </div>
      </div>
    </div>
  )
}
