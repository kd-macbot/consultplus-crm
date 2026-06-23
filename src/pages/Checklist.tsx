import { useEffect, useMemo, useState, useRef } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Search, Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '../lib/auth'
import { ensureChecklistRows, upsertChecklistByKey } from '../lib/storage'
import {
  useClients, useColumns, useCellValues, useDropdownOptions, useStaff,
  useChecklist, useInvalidateCrm,
} from '../lib/queries'
import { queryClient } from '../lib/queryClient'
import { CHECKLIST_FIELDS, type ChecklistRow, type Client } from '../lib/types'
import {
  buildCellIndex, buildDropdownIndex, clientDisplayName, resolveDropdownText, cellKey,
} from '../lib/tableIndices'
import { isHiddenStatus } from '../lib/statusBadge'
import { MONTH_NAMES, previousMonth, namesMatch } from '../lib/utils'
import { useRealtime } from '../lib/useRealtime'

const SALES_FIELDS = CHECKLIST_FIELDS.filter(f => f.group === 'sales')
const PURCHASE_FIELDS = CHECKLIST_FIELDS.filter(f => f.group === 'purchases')

// Срок за ДДС е 14-ти на месеца СЛЕД работния месец (декларира се за изминалия).
function ddsDeadline(year: number, month: number): Date {
  const dy = month === 12 ? year + 1 : year
  const dm = month === 12 ? 1 : month + 1
  return new Date(dy, dm - 1, 14, 23, 59, 59)
}

type ResultStatus = 'done' | 'progress' | 'overdue' | 'none'

function resultOf(row: ChecklistRow | undefined, deadline: Date): ResultStatus {
  const total = CHECKLIST_FIELDS.length
  const done = row ? CHECKLIST_FIELDS.filter(f => row[f.key]).length : 0
  if (done === total) return 'done'
  if (Date.now() > deadline.getTime()) return 'overdue'
  if (done > 0) return 'progress'
  return 'none'
}

const RESULT_BADGE: Record<ResultStatus, { label: string; cls: string }> = {
  done:     { label: 'Готов',     cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  progress: { label: 'В процес',  cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  overdue:  { label: 'Просрочен', cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  none:     { label: '—',         cls: 'bg-muted/40 text-muted-foreground' },
}

// ISO timestamp → „17.06 14:30" за tooltip-а на атрибуцията.
function formatStamp(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// Бележка — записва се при напускане на полето (onBlur), само ако е променена.
function NoteCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  return (
    <input
      type="text"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onSave(draft) }}
      placeholder="—"
      className="w-full min-w-[160px] h-7 px-2 text-xs border border-border rounded bg-background focus:border-primary focus:outline-none"
    />
  )
}

export function ChecklistPage() {
  const { user } = useAuth()
  const initial = previousMonth()
  const [year, setYear] = useState(initial.year)
  const [month, setMonth] = useState(initial.month)

  const clientsQ = useClients()
  const columnsQ = useColumns()
  const cellsQ = useCellValues()
  const dropdownsQ = useDropdownOptions()
  const staffQ = useStaff()
  const { invalidateChecklist } = useInvalidateCrm()

  const clients = useMemo(() => clientsQ.data ?? [], [clientsQ.data])
  const columns = useMemo(() => columnsQ.data ?? [], [columnsQ.data])
  const cells = useMemo(() => cellsQ.data ?? [], [cellsQ.data])
  const dropdowns = useMemo(() => dropdownsQ.data ?? [], [dropdownsQ.data])
  const staff = useMemo(() => staffQ.data ?? [], [staffQ.data])
  const masterReady = !!clientsQ.data && !!columnsQ.data && !!cellsQ.data && !!dropdownsQ.data && !!staffQ.data

  const checklistQ = useChecklist(year, month)
  const rows = useMemo(() => {
    const m = new Map<string, ChecklistRow>()
    ;(checklistQ.data ?? []).forEach(r => m.set(r.client_id, r))
    return m
  }, [checklistQ.data])

  const [search, setSearch] = useState('')
  const [savingFor, setSavingFor] = useState<Set<string>>(new Set())
  const lastEditRef = useRef(0)
  const deferEdits = () => Date.now() - lastEditRef.current < 3000

  const isAdmin = user?.role === 'admin'

  // Текущият потребител → staff запис (по име) → отдел.
  const myStaff = useMemo(
    () => staff.find(s => namesMatch(s.full_name, user?.full_name)),
    [staff, user?.full_name],
  )
  const isTrz = myStaff?.department === 'ТРЗ'
  const myName = user?.full_name ?? ''

  const cellIdx = useMemo(() => buildCellIndex(cells), [cells])
  const dropdownIdx = useMemo(() => buildDropdownIndex(dropdowns), [dropdowns])

  const statusCol = useMemo(() => columns.find(c => c.name === 'Статус'), [columns])
  const accountantCol = useMemo(() => columns.find(c => c.name === 'Счетоводител'), [columns])
  const respCol = useMemo(() => columns.find(c => c.name === 'Отговорник'), [columns])

  function valueOf(clientId: string, colId: string | undefined): string {
    if (!colId) return ''
    const cell = cellIdx.get(cellKey(clientId, colId))
    if (!cell) return ''
    if (cell.value_text) return cell.value_text
    if (cell.value_dropdown) return dropdownIdx.get(cell.value_dropdown)?.value ?? ''
    return ''
  }

  const deadline = useMemo(() => ddsDeadline(year, month), [year, month])

  type Row = { client: Client; name: string; accountant: string; responsible: string }
  const tableRows: Row[] = useMemo(() => {
    return clients
      .map(c => ({
        client: c,
        name: clientDisplayName(c.id, columns, cellIdx),
        status: resolveDropdownText(c.id, statusCol, cellIdx, dropdownIdx),
        accountant: valueOf(c.id, accountantCol?.id),
        responsible: valueOf(c.id, respCol?.id),
      }))
      // „Без дейност" / „Без ДДС" не участват в ДДС чеклиста
      .filter(r => !isHiddenStatus(r.status))
      // Само зачислените на текущия потребител (admin вижда всички)
      .filter(r => isAdmin || r.accountant === myName || r.responsible === myName)
      .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, columns, cellIdx, dropdownIdx, statusCol, accountantCol, respCol, isAdmin, myName])

  const filteredRows = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return tableRows
    return tableRows.filter(r => r.name.toLowerCase().includes(s))
  }, [tableRows, search])

  const loading = !masterReady || (checklistQ.isLoading && !checklistQ.data)

  // Подготвяме редовете за видимите фирми (фон, не блокира UI).
  useEffect(() => {
    if (!masterReady || isTrz) return
    const ids = tableRows.map(r => r.client.id)
    if (ids.length === 0) return
    void ensureChecklistRows(ids, year, month, user?.id)
      .then(created => { if (created > 0) invalidateChecklist(year, month) })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, masterReady, tableRows.length])

  useRealtime({
    channel: 'checklist-master',
    tables: ['crm_cell_values', 'crm_clients'],
    onChange: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      queryClient.invalidateQueries({ queryKey: ['cells'] })
    },
    shouldDefer: deferEdits,
  })
  useRealtime({
    channel: 'checklist-month',
    tables: ['crm_checklist'],
    onChange: () => invalidateChecklist(year, month),
    shouldDefer: deferEdits,
  })

  async function toggle(clientId: string, key: keyof ChecklistRow, value: boolean) {
    lastEditRef.current = Date.now()
    // Атрибуция: при отмятане записваме кой и кога; при размаркиране — чистим.
    const current = rows.get(clientId)
    const nextCheckedBy = { ...(current?.checked_by ?? {}) }
    if (value) nextCheckedBy[key as string] = { name: myName || 'неизвестен', at: new Date().toISOString() }
    else delete nextCheckedBy[key as string]
    const patch = { [key]: value, checked_by: nextCheckedBy } as Partial<ChecklistRow>
    // Оптимистичен update в RQ кеша
    queryClient.setQueryData<ChecklistRow[]>(['checklist', year, month], (prev) => {
      if (!prev) return prev
      const idx = prev.findIndex(r => r.client_id === clientId)
      if (idx >= 0) return prev.map((r, i) => i === idx ? { ...r, ...patch } : r)
      return [...prev, { client_id: clientId, year, month, ...patch } as ChecklistRow]
    })
    setSavingFor(prev => new Set(prev).add(clientId))
    try {
      await upsertChecklistByKey(clientId, year, month, patch, user?.id)
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
      invalidateChecklist(year, month)
    } finally {
      setSavingFor(prev => { const n = new Set(prev); n.delete(clientId); return n })
    }
  }

  async function saveNotes(clientId: string, notes: string) {
    lastEditRef.current = Date.now()
    const patch = { notes: notes || null } as Partial<ChecklistRow>
    queryClient.setQueryData<ChecklistRow[]>(['checklist', year, month], (prev) => {
      if (!prev) return prev
      const idx = prev.findIndex(r => r.client_id === clientId)
      if (idx >= 0) return prev.map((r, i) => i === idx ? { ...r, ...patch } : r)
      return [...prev, { client_id: clientId, year, month, ...patch } as ChecklistRow]
    })
    try {
      await upsertChecklistByKey(clientId, year, month, patch, user?.id)
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
      invalidateChecklist(year, month)
    }
  }

  function changeMonth(delta: number) {
    let m = month + delta
    let y = year
    if (m < 1) { m = 12; y -= 1 }
    else if (m > 12) { m = 1; y += 1 }
    setMonth(m); setYear(y)
  }

  if (isTrz) {
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-3 text-center text-muted-foreground">
        <ShieldAlert className="h-10 w-10 opacity-40" />
        <p className="text-sm">Личният чек лист е за счетоводния отдел.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] md:h-screen">
      {/* Title bar */}
      <div className="px-3 py-2 md:px-5 md:py-3 flex items-center justify-between border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <h1 className="text-lg md:text-xl font-bold text-foreground whitespace-nowrap">Личен чек лист</h1>
          <span className="text-xs text-muted-foreground hidden sm:inline">ДДС · срок 14-ти</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => changeMonth(-1)} className="h-8 w-8"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-sm font-medium min-w-[120px] text-center">{MONTH_NAMES[month - 1]} {year}</span>
          <Button variant="ghost" size="icon" onClick={() => changeMonth(1)} className="h-8 w-8"><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => { const p = previousMonth(); setYear(p.year); setMonth(p.month) }}>Работен месец</Button>
          <Button variant="ghost" size="sm" onClick={() => { const d = new Date(); setYear(d.getFullYear()); setMonth(d.getMonth() + 1) }}>Календарен месец</Button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 md:px-5 py-2 border-b border-border bg-card flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Търси фирма..." className="h-8 pl-8 w-44 text-sm" />
        </div>
        <span className="text-xs text-muted-foreground">{filteredRows.length} фирми</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-6 flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Зареждане...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Няма зачислени фирми за този период.</div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-30 bg-navy text-white">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap w-12">#</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap sticky left-0 z-40 bg-navy">Фирма</th>
                <th className="px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider border-l-2 border-white/20" colSpan={SALES_FIELDS.length}>Продажби</th>
                <th className="px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider border-l-2 border-white/20" colSpan={PURCHASE_FIELDS.length}>Покупки</th>
                <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider border-l-2 border-white/20" rowSpan={2}>Резултат</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider border-l-2 border-white/20" rowSpan={2}>Бележка</th>
              </tr>
              <tr className="bg-navy/90">
                <th></th>
                <th className="sticky left-0 z-40 bg-navy"></th>
                {CHECKLIST_FIELDS.map((f, i) => (
                  <th key={f.key}
                    className={`px-1 py-2 text-center text-[10px] font-medium align-bottom ${i === SALES_FIELDS.length ? 'border-l-2 border-white/20' : ''}`}
                    style={{ width: 72, minWidth: 72 }}>
                    <span className="block leading-tight whitespace-normal break-words">{f.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, i) => {
                const r = rows.get(row.client.id)
                const isSaving = savingFor.has(row.client.id)
                const evenBg = i % 2 === 0 ? 'bg-card' : 'bg-muted/20'
                const result = resultOf(r, deadline)
                const badge = RESULT_BADGE[result]
                const rowBg = result === 'done'
                  ? (i % 2 === 0 ? 'bg-emerald-50 dark:bg-emerald-950/40' : 'bg-emerald-100/60 dark:bg-emerald-950/30')
                  : evenBg
                return (
                  <tr key={row.client.id} className={`border-b border-light/50 hover:bg-gold/5 transition-colors ${rowBg}`}>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground/70 text-right">{i + 1}</td>
                    <td className={`px-3 py-1.5 font-medium text-foreground whitespace-nowrap truncate max-w-[220px] sticky left-0 z-10 ${rowBg}`} title={row.name}>
                      {row.name || <span className="text-muted-foreground/40 italic">(без име)</span>}
                      {isSaving && <Loader2 className="inline ml-1 h-3 w-3 animate-spin text-muted-foreground" />}
                    </td>
                    {CHECKLIST_FIELDS.map((f, ci) => {
                      const checked = !!r?.[f.key]
                      const by = checked ? r?.checked_by?.[f.key] : undefined
                      const tip = by ? `${by.name} · ${formatStamp(by.at)}` : undefined
                      return (
                        <td key={f.key} className={`px-1 py-1.5 text-center ${ci === SALES_FIELDS.length ? 'border-l-2 border-border' : ''}`} title={tip}>
                          <input type="checkbox"
                            checked={checked}
                            onChange={e => toggle(row.client.id, f.key, e.target.checked)}
                            className="h-4 w-4 cursor-pointer accent-emerald-600" />
                        </td>
                      )
                    })}
                    <td className="px-3 py-1.5 text-center border-l-2 border-border">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${badge.cls}`}>{badge.label}</span>
                    </td>
                    <td className="px-2 py-1 border-l-2 border-border">
                      <NoteCell
                        key={`${row.client.id}-${year}-${month}`}
                        value={r?.notes ?? ''}
                        onSave={v => saveNotes(row.client.id, v)}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
