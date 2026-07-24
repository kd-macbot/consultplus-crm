import { useMemo, useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { Search, AlertTriangle, Briefcase, FileText, Star } from 'lucide-react'
import { useAuth } from '../lib/auth'
import {
  useClients, useColumns, useCellValues, useDropdownOptions, useClientProfiles, useInvalidateCrm,
} from '../lib/queries'
import { upsertClientProfile, setCellValue } from '../lib/storage'
import type { ClientProfile } from '../lib/types'
import { usePersistentState } from '../lib/usePersistentState'

type ProfileField = 'business_activity' | 'business_notes' | 'warnings'

// Inline textarea, която запазва при загубване на фокус, ако стойността е променена.
function ProfileCell({
  value, onSave, placeholder, accent,
}: {
  value: string
  onSave: (v: string) => void
  placeholder: string
  accent?: 'warning'
}) {
  const [draft, setDraft] = useState(value)
  // Sync при промяна отвън (напр. след invalidate).
  useEffect(() => { setDraft(value) }, [value])

  return (
    <textarea
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onSave(draft) }}
      placeholder={placeholder}
      rows={2}
      className={
        'w-full min-h-[44px] resize-y px-2 py-1.5 text-xs border rounded bg-background ' +
        'focus:border-primary focus:outline-none transition-colors ' +
        (accent === 'warning'
          ? 'border-red-300 bg-red-50/40 dark:bg-red-950/20 dark:border-red-900 placeholder:text-red-400/60'
          : 'border-border placeholder:text-muted-foreground/50')
      }
    />
  )
}

// Цвят за всяка стойност на оценката — еднакъв с този в Работен лист, за да
// колегите разпознаят клиента и тук.
const RATING_COLORS: Record<string, string> = {
  'Ок':         'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  'Обемен':     'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
  'Изискващ':   'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800',
  'Проблемен':  'bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800',
}

// Dropdown за оценка на клиента — записва се директно в crm_cell_values
// (същата колона, която се вижда и в Работен лист). Без миграция на данни.
function RatingCell({
  value, options, onSave,
}: {
  value: string  // option ID или ''
  options: { id: string; value: string }[]
  onSave: (optionId: string | null) => void
}) {
  const current = options.find(o => o.id === value)
  const accent = current ? RATING_COLORS[current.value] ?? 'bg-muted text-foreground border-border' : ''
  return (
    <select
      value={value}
      onChange={e => onSave(e.target.value || null)}
      className={
        'w-full h-7 px-2 text-xs border rounded focus:border-primary focus:outline-none ' +
        (current ? accent : 'bg-background border-border text-muted-foreground')
      }
    >
      <option value="">—</option>
      {options.map(o => (
        <option key={o.id} value={o.id}>{o.value}</option>
      ))}
    </select>
  )
}

export function ClientProfilesPage() {
  const { user } = useAuth()
  const clientsQ = useClients()
  const columnsQ = useColumns()
  const cellsQ = useCellValues()
  const dropdownsQ = useDropdownOptions()
  const profilesQ = useClientProfiles()
  const { invalidateClientProfiles, invalidateCells } = useInvalidateCrm()

  const clients = useMemo(() => clientsQ.data ?? [], [clientsQ.data])
  const columns = useMemo(() => columnsQ.data ?? [], [columnsQ.data])
  const cells = useMemo(() => cellsQ.data ?? [], [cellsQ.data])
  const dropdowns = useMemo(() => dropdownsQ.data ?? [], [dropdownsQ.data])

  // Името на фирмата е стойността от първата text колона (както на другите страници).
  const nameColId = useMemo(
    () => [...columns].sort((a, b) => a.position - b.position).find(c => c.type === 'text')?.id,
    [columns],
  )
  const nameByClient = useMemo(() => {
    const m = new Map<string, string>()
    if (!nameColId) return m
    cells.forEach(c => {
      if (c.column_id === nameColId && c.value_text) m.set(c.client_id, c.value_text)
    })
    return m
  }, [cells, nameColId])

  // ============================================================
  // „Оценка на клиент" — четем и пишем директно в crm_cell_values,
  // т.е. ползваме съществуващата dropdown колона от Работен лист.
  // Така няма дублиране на данни между двата екрана.
  // ============================================================
  const ratingCol = useMemo(
    () => columns.find(c => c.name === 'Оценка на клиент' && c.type === 'dropdown'),
    [columns],
  )
  const ratingOptions = useMemo(
    () => dropdowns
      .filter(o => o.column_id === ratingCol?.id)
      .sort((a, b) => a.position - b.position),
    [dropdowns, ratingCol?.id],
  )
  const ratingByClient = useMemo(() => {
    const m = new Map<string, string>()  // client_id → option_id
    if (!ratingCol) return m
    cells.forEach(c => {
      if (c.column_id === ratingCol.id && c.value_dropdown) m.set(c.client_id, c.value_dropdown)
    })
    return m
  }, [cells, ratingCol])

  // Profile-ите по client_id за бърз lookup.
  const profileByClient = useMemo(() => {
    const m = new Map<string, ClientProfile>()
    ;(profilesQ.data ?? []).forEach(p => m.set(p.client_id, p))
    return m
  }, [profilesQ.data])

  const [search, setSearch] = usePersistentState('profiles-search', '')
  const [savingFor, setSavingFor] = useState<Set<string>>(new Set())

  // LEFT JOIN: всички клиенти, дори тези без профил. Подреждаме по име.
  const rows = useMemo(() => {
    const all = clients.map(c => ({
      clientId: c.id,
      name: nameByClient.get(c.id) ?? '—',
      profile: profileByClient.get(c.id),
      ratingOptionId: ratingByClient.get(c.id) ?? '',
    }))
    const q = search.trim().toLowerCase()
    const filtered = q
      ? all.filter(r => r.name.toLowerCase().includes(q))
      : all
    return filtered.sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  }, [clients, nameByClient, profileByClient, ratingByClient, search])

  const ready = !!clientsQ.data && !!columnsQ.data && !!cellsQ.data && !!dropdownsQ.data && !!profilesQ.data

  // ============================================================
  // Запис на едно поле — optimistic update в RQ кеша + invalidate.
  // ============================================================
  const saveField = useCallback(async (clientId: string, field: ProfileField, value: string) => {
    setSavingFor(prev => new Set(prev).add(clientId + ':' + field))
    try {
      await upsertClientProfile(clientId, { [field]: value || null }, user?.id)
      await invalidateClientProfiles()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
    } finally {
      setSavingFor(prev => {
        const next = new Set(prev)
        next.delete(clientId + ':' + field)
        return next
      })
    }
  }, [user?.id, invalidateClientProfiles])

  const saveRating = useCallback(async (clientId: string, optionId: string | null) => {
    if (!ratingCol) return
    setSavingFor(prev => new Set(prev).add(clientId + ':rating'))
    try {
      const oldOpt = ratingOptions.find(o => o.id === ratingByClient.get(clientId))
      const newOpt = ratingOptions.find(o => o.id === optionId)
      await setCellValue(
        clientId,
        ratingCol.id,
        { value_dropdown: optionId },
        {
          userId: user?.id,
          userName: user?.full_name,
          clientName: nameByClient.get(clientId),
          columnName: ratingCol.name,
          oldDisplay: oldOpt?.value ?? '',
          newDisplay: newOpt?.value ?? '',
        },
      )
      await invalidateCells()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
    } finally {
      setSavingFor(prev => {
        const next = new Set(prev)
        next.delete(clientId + ':rating')
        return next
      })
    }
  }, [ratingCol, ratingOptions, ratingByClient, nameByClient, user?.id, user?.full_name, invalidateCells])

  // ============================================================
  // Брой попълнени профили (за статистика горе).
  // ============================================================
  const stats = useMemo(() => {
    let filled = 0
    let withWarnings = 0
    rows.forEach(r => {
      const p = r.profile
      if (p && (p.business_activity || p.business_notes || p.warnings)) filled++
      if (p && p.warnings && p.warnings.trim()) withWarnings++
    })
    return { total: rows.length, filled, withWarnings }
  }, [rows])

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-full min-h-[50vh] text-muted-foreground">
        <div className="flex items-center gap-2 text-sm">
          <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Зареждане...
        </div>
      </div>
    )
  }

  const colCount = ratingCol ? 5 : 4

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
      {/* Header */}
      <div className="px-3 py-2 md:px-5 md:py-3 border-b border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h1 className="text-base md:text-lg font-semibold text-foreground">Профили на клиенти</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Бизнес контекст и неща, на които да се внимава за всяка фирма.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>Общо: <span className="font-semibold text-foreground">{stats.total}</span></span>
            <span>Попълнени: <span className="font-semibold text-foreground">{stats.filled}</span></span>
            <span className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-red-500" />
              С внимание: <span className="font-semibold text-foreground">{stats.withWarnings}</span>
            </span>
          </div>
        </div>

        <div className="mt-2 relative">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Търси фирма по име..."
            className="w-full md:w-80 pl-8 pr-3 py-1.5 text-xs border border-border rounded bg-background focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10 bg-card border-b border-border">
            <tr>
              <th className="text-left px-3 py-2 font-semibold text-foreground min-w-[200px] sticky left-0 bg-card z-20">
                Фирма
              </th>
              {ratingCol && (
                <th className="text-left px-3 py-2 font-semibold text-foreground min-w-[130px]">
                  <div className="flex items-center gap-1.5">
                    <Star className="h-3.5 w-3.5 text-muted-foreground" />
                    Оценка
                  </div>
                </th>
              )}
              <th className="text-left px-3 py-2 font-semibold text-foreground min-w-[200px]">
                <div className="flex items-center gap-1.5">
                  <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                  Дейност
                </div>
              </th>
              <th className="text-left px-3 py-2 font-semibold text-foreground min-w-[260px]">
                <div className="flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  Особености
                </div>
              </th>
              <th className="text-left px-3 py-2 font-semibold text-red-700 dark:text-red-400 min-w-[260px]">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Внимавай
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="text-center py-12 text-muted-foreground">
                  {search ? 'Няма намерени фирми.' : 'Няма клиенти.'}
                </td>
              </tr>
            ) : rows.map(({ clientId, name, profile, ratingOptionId }) => (
              <tr key={clientId} className="border-b border-border hover:bg-accent/30">
                <td className="px-3 py-2 sticky left-0 bg-background z-10 border-r border-border align-top">
                  <div className="font-medium text-foreground">{name}</div>
                </td>
                {ratingCol && (
                  <td className="px-3 py-2 align-top">
                    <RatingCell
                      value={ratingOptionId}
                      options={ratingOptions}
                      onSave={opt => saveRating(clientId, opt)}
                    />
                  </td>
                )}
                <td className="px-3 py-2 align-top">
                  <ProfileCell
                    value={profile?.business_activity ?? ''}
                    onSave={v => saveField(clientId, 'business_activity', v)}
                    placeholder="напр. Магазин за дрехи, IT консултации..."
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <ProfileCell
                    value={profile?.business_notes ?? ''}
                    onSave={v => saveField(clientId, 'business_notes', v)}
                    placeholder="ДДС режим, сезонност, как пращат документи..."
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <ProfileCell
                    value={profile?.warnings ?? ''}
                    onSave={v => saveField(clientId, 'warnings', v)}
                    placeholder="Червени флагове, проблеми, специфики..."
                    accent="warning"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer: брой записващи се полета (диагностика) */}
      {savingFor.size > 0 && (
        <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-t border-border bg-card">
          Записване... ({savingFor.size})
        </div>
      )}
    </div>
  )
}
