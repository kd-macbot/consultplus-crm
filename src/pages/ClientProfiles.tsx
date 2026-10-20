import { useMemo, useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { Search, AlertTriangle, Briefcase, FileText, Star, X } from 'lucide-react'
import { useAuth } from '../lib/auth'
import {
  useClients, useColumns, useCellValues, useDropdownOptions, useClientProfiles, useInvalidateCrm,
} from '../lib/queries'
import { upsertClientProfile, setCellValue } from '../lib/storage'
import type { ClientProfile } from '../lib/types'
import { usePersistentState } from '../lib/usePersistentState'
import { namesMatch } from '../lib/utils'
import { buildCellIndex, buildDropdownIndex, resolveCellText } from '../lib/tableIndices'
import {
  peopleOptions, matchesPerson, matchesRating, activeFilterCount, EMPTY_FILTER,
} from '../lib/profileFilters'

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

/**
 * Едно падащо меню за филтър. Приема или готови имена (хората — стойността
 * Е самото име), или двойки (оценката — стойността е id на опцията).
 *
 * `emptyOption` се подава САМО когато в данните наистина има незададени —
 * избор „Без счетоводител" в таблица, където всички имат, е излишен ред,
 * който връща нула резултата и изглежда като грешка.
 */
function FilterSelect({
  label, value, onChange, options, emptyOption,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[] | { value: string; label: string }[]
  emptyOption: string | null
}) {
  const items = options.map(o => typeof o === 'string' ? { value: o, label: o } : o)
  const active = value !== ''
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      aria-label={label}
      className={
        'h-[30px] px-2 text-xs border rounded focus:border-primary focus:outline-none ' +
        (active
          ? 'border-primary bg-primary/5 text-foreground font-medium'
          : 'border-border bg-background text-muted-foreground')
      }
    >
      <option value="">{label}: всички</option>
      {emptyOption && <option value={EMPTY_FILTER}>{emptyOption}</option>}
      {items.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
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

  // Счетоводител и Отговорник — за филтрите. ⚠️ И двете са dropdown колони,
  // СВЪРЗАНИ СЪС СЛУЖИТЕЛ, тоест стойността стои във `value_text`, а не във
  // `value_dropdown`. Затова се чете с `resolveCellText`; `resolveDropdownText`
  // би върнал празно и филтърът щеше да е празен, без да се оплаче.
  const cellIdx = useMemo(() => buildCellIndex(cells), [cells])
  const dropdownIdx = useMemo(() => buildDropdownIndex(dropdowns), [dropdowns])
  const accountantCol = useMemo(() => columns.find(c => c.name === 'Счетоводител'), [columns])
  const respCol = useMemo(() => columns.find(c => c.name === 'Отговорник'), [columns])

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
  const [fAccountant, setFAccountant] = usePersistentState('profiles-f-accountant', '')
  const [fResp, setFResp] = usePersistentState('profiles-f-resp', '')
  const [fRating, setFRating] = usePersistentState('profiles-f-rating', '')
  const [savingFor, setSavingFor] = useState<Set<string>>(new Set())

  // LEFT JOIN: всички клиенти, дори тези без профил. Подреждаме по име.
  // `allRows` е БЕЗ филтри — от него се пълнят менютата и се брои „от колко".
  const allRows = useMemo(() => clients.map(c => ({
    clientId: c.id,
    name: nameByClient.get(c.id) ?? '—',
    profile: profileByClient.get(c.id),
    ratingOptionId: ratingByClient.get(c.id) ?? '',
    accountant: resolveCellText(c.id, accountantCol, cellIdx, dropdownIdx),
    responsible: resolveCellText(c.id, respCol, cellIdx, dropdownIdx),
  })).sort((a, b) => a.name.localeCompare(b.name, 'bg')),
  [clients, nameByClient, profileByClient, ratingByClient, accountantCol, respCol, cellIdx, dropdownIdx])

  // Менютата се пълнят от ДАННИТЕ, не от списъка със служители: предлага се
  // само човек, който наистина има фирми тук. Имената се сливат по
  // нормализиран вид — иначе един и същи колега излиза два пъти.
  const accountantOptions = useMemo(
    () => peopleOptions(allRows.map(r => r.accountant)), [allRows])
  const respOptions = useMemo(
    () => peopleOptions(allRows.map(r => r.responsible)), [allRows])
  const hasUnrated = useMemo(() => allRows.some(r => !r.ratingOptionId), [allRows])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allRows.filter(r =>
      (!q || r.name.toLowerCase().includes(q)) &&
      matchesPerson(r.accountant, fAccountant) &&
      matchesPerson(r.responsible, fResp) &&
      matchesRating(r.ratingOptionId, fRating),
    )
  }, [allRows, search, fAccountant, fResp, fRating])

  const ready = !!clientsQ.data && !!columnsQ.data && !!cellsQ.data && !!dropdownsQ.data && !!profilesQ.data

  // ЗАПАЗЕНИЯТ ФИЛТЪР МОЖЕ ДА ОСТАРЕЕ. Стойността му е ИМЕ (или id на оценка),
  // а имената в Клиенти се менят и колеги напускат. Тогава `<select>` няма
  // съвпадаща опция и показва „всички", но състоянието още държи старото име —
  // тоест таблицата излиза празна, а лентата изглежда чиста. Затова филтър
  // без опция се зачиства сам.
  useEffect(() => {
    // САМО след като данните са дошли. При първо зареждане менютата са
    // празни и проверката би изтрила запазения филтър, преди да има какво
    // да сравни — тоест запазването щеше да е безполезно.
    if (!ready) return
    // Долепя се до СЪЩЕСТВУВАЩАТА опция, не само се чисти: ако името е
    // записано с друг регистър или интервали, `namesMatch` го признава, но
    // `<select>` няма опция с точно тази стойност и пак би показал „всички"
    // при активен филтър. Липсва ли съвпадение изобщо → зачиства се.
    if (fAccountant && fAccountant !== EMPTY_FILTER) {
      const hit = accountantOptions.names.find(n => namesMatch(n, fAccountant))
      if (hit !== fAccountant) setFAccountant(hit ?? '')
    }
    if (fResp && fResp !== EMPTY_FILTER) {
      const hit = respOptions.names.find(n => namesMatch(n, fResp))
      if (hit !== fResp) setFResp(hit ?? '')
    }
    if (fRating && fRating !== EMPTY_FILTER &&
        !ratingOptions.some(o => o.id === fRating)) setFRating('')
  }, [ready, accountantOptions.names, respOptions.names, ratingOptions,
      fAccountant, fResp, fRating, setFAccountant, setFResp, setFRating])

  const activeFilters = activeFilterCount({
    search, accountant: fAccountant, responsible: fResp, rating: fRating,
  })
  const clearFilters = useCallback(() => {
    setSearch(''); setFAccountant(''); setFResp(''); setFRating('')
  }, [setSearch, setFAccountant, setFResp, setFRating])

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
            <span>
              {activeFilters > 0 ? 'Показани: ' : 'Общо: '}
              <span className="font-semibold text-foreground">{stats.total}</span>
              {activeFilters > 0 && <span className="text-muted-foreground"> от {allRows.length}</span>}
            </span>
            <span>Попълнени: <span className="font-semibold text-foreground">{stats.filled}</span></span>
            <span className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-red-500" />
              С внимание: <span className="font-semibold text-foreground">{stats.withWarnings}</span>
            </span>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Търси фирма по име..."
              className="w-full md:w-72 pl-8 pr-3 py-1.5 text-xs border border-border rounded bg-background focus:border-primary focus:outline-none"
            />
          </div>

          {/* Филтрите излизат само ако колоната изобщо съществува — иначе
              щеше да стои празно меню, което изглежда като счупено. */}
          {accountantCol && (
            <FilterSelect
              label="Счетоводител"
              value={fAccountant}
              onChange={setFAccountant}
              options={accountantOptions.names}
              emptyOption={accountantOptions.hasEmpty ? 'Без счетоводител' : null}
            />
          )}
          {respCol && (
            <FilterSelect
              label="Отговорник"
              value={fResp}
              onChange={setFResp}
              options={respOptions.names}
              emptyOption={respOptions.hasEmpty ? 'Без отговорник' : null}
            />
          )}
          {ratingCol && (
            <FilterSelect
              label="Оценка"
              value={fRating}
              onChange={setFRating}
              options={ratingOptions.map(o => ({ value: o.id, label: o.value }))}
              emptyOption={hasUnrated ? 'Без оценка' : null}
            />
          )}

          {activeFilters > 0 && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-2 py-1.5 text-xs border border-border rounded hover:bg-muted transition-colors"
              title="Изчисти търсенето и филтрите"
            >
              <X className="h-3.5 w-3.5" />
              Изчисти ({activeFilters})
            </button>
          )}
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
                  {activeFilters > 0 ? 'Няма фирми по тези филтри.' : 'Няма клиенти.'}
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
