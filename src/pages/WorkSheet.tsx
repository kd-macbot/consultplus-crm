import { useEffect, useMemo, useState, useRef } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Search, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '../lib/auth'
import {
  getClients, getColumns, getCellValues, getDropdownOptions,
  getMonthlyWork, ensureMonthlyRows, upsertMonthlyWorkByKey,
} from '../lib/storage'
import { NOTIFICATION_METHODS, type MonthlyWork, type Client, type Column, type CellValue, type DropdownOption } from '../lib/types'

const MONTH_NAMES = [
  'Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни',
  'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември',
]

function formatCurrency(v: number | null): string {
  if (v == null) return ''
  return new Intl.NumberFormat('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}

function clientNameOf(clientId: string, columns: Column[], cells: CellValue[]): string {
  for (const col of columns) {
    if (col.type === 'text') {
      const cell = cells.find(cv => cv.client_id === clientId && cv.column_id === col.id)
      if (cell?.value_text) return cell.value_text
    }
  }
  return ''
}

function clientStatusOf(clientId: string, statusCol: Column | undefined, cells: CellValue[], dropdowns: DropdownOption[]): string {
  if (!statusCol) return ''
  const cell = cells.find(cv => cv.client_id === clientId && cv.column_id === statusCol.id)
  if (!cell?.value_dropdown) return ''
  return dropdowns.find(d => d.id === cell.value_dropdown)?.value ?? ''
}

const STATUS_BADGE: Record<string, string> = {
  'АКТИВНА': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  'НУЛЕВО': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
}

type Relevance = 'due' | 'optional' | 'na'

/** Авансова вноска: relevance за дадения месец според профила на клиента */
function advanceRelevance(profile: string, month: number): Relevance {
  if (profile === 'Месечни') return 'due'
  if (profile === 'Тримесечни') return [4, 7, 10].includes(month) ? 'due' : 'optional'
  return 'na'
}

/** Чл. 55 ЗДДФЛ: подава се тримесечно (срок: края на месеца след тримесечието) */
function art55Relevance(applies: string, month: number): Relevance {
  if (applies !== 'ДА') return 'na'
  return [1, 4, 7, 10].includes(month) ? 'due' : 'optional'
}

function advanceDeadline(profile: string, month: number): string | null {
  if (profile === 'Месечни') return `до 15.${String(month).padStart(2, '0')}`
  if (profile === 'Тримесечни' && [4, 7, 10].includes(month)) return `до 15.${String(month).padStart(2, '0')}`
  return null
}

function art55Deadline(applies: string, month: number): string | null {
  if (applies !== 'ДА') return null
  if (![1, 4, 7, 10].includes(month)) return null
  const lastDay = new Date(2024, month, 0).getDate()
  return `до ${lastDay}.${String(month).padStart(2, '0')}`
}

function masterValue(clientId: string, col: Column | undefined, cells: CellValue[], dropdowns: DropdownOption[]): string {
  if (!col) return ''
  const cell = cells.find(cv => cv.client_id === clientId && cv.column_id === col.id)
  if (!cell?.value_dropdown) return ''
  return dropdowns.find(d => d.id === cell.value_dropdown)?.value ?? ''
}

export function WorkSheetPage() {
  const { user } = useAuth()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const [clients, setClients] = useState<Client[]>([])
  const [columns, setColumns] = useState<Column[]>([])
  const [cells, setCells] = useState<CellValue[]>([])
  const [dropdowns, setDropdowns] = useState<DropdownOption[]>([])
  const [rows, setRows] = useState<Map<string, MonthlyWork>>(new Map())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string[]>([])  // празно = всички
  const [savingFor, setSavingFor] = useState<Set<string>>(new Set())

  const canEdit = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'employee'

  useEffect(() => { void loadAll() }, [year, month])

  async function loadAll() {
    setLoading(true)
    try {
      // 1. Базови данни (само първия път или ако се променят клиенти)
      const [cls, cols, cvs, dds] = await Promise.all([
        getClients(), getColumns(), getCellValues(), getDropdownOptions(),
      ])
      setClients(cls)
      setColumns(cols)
      setCells(cvs)
      setDropdowns(dds)

      // 2. Уверяваме се, че всеки клиент има ред за избрания месец
      const ids = cls.map(c => c.id)
      const created = await ensureMonthlyRows(ids, year, month, user?.id)
      if (created > 0) toast.info(`Създадени ${created} нови реда за ${MONTH_NAMES[month - 1]} ${year}`)

      // 3. Зареждаме редовете за избрания месец
      const work = await getMonthlyWork(year, month)
      setRows(new Map(work.map(w => [w.client_id, w])))
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при зареждане')
    }
    setLoading(false)
  }

  const statusCol = useMemo(() => columns.find(c => c.name === 'Статус'), [columns])
  const advanceCol = useMemo(() => columns.find(c => c.name === 'Авансови вноски'), [columns])
  const art55Col = useMemo(() => columns.find(c => c.name === 'Чл. 55 ЗДДФЛ'), [columns])

  // Списък със стойности на статуса (за филтър)
  const statusOptions = useMemo(() => {
    if (!statusCol) return [] as string[]
    return [...new Set(dropdowns.filter(d => d.column_id === statusCol.id).map(d => d.value))]
  }, [dropdowns, statusCol])

  // Подготвени клиенти за render: name, status, monthly row
  type Row = { client: Client; name: string; status: string; advance: string; art55: string; work: MonthlyWork | undefined }
  const tableRows: Row[] = useMemo(() => {
    const visible = user?.role === 'employee'
      ? clients.filter(c => c.assigned_to === user.id)
      : clients
    return visible
      .map(c => ({
        client: c,
        name: clientNameOf(c.id, columns, cells),
        status: clientStatusOf(c.id, statusCol, cells, dropdowns),
        advance: masterValue(c.id, advanceCol, cells, dropdowns),
        art55: masterValue(c.id, art55Col, cells, dropdowns),
        work: rows.get(c.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  }, [clients, columns, cells, dropdowns, statusCol, advanceCol, art55Col, rows, user])

  const filteredRows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return tableRows.filter(r => {
      if (statusFilter.length > 0 && !statusFilter.includes(r.status)) return false
      if (s && !r.name.toLowerCase().includes(s)) return false
      return true
    })
  }, [tableRows, search, statusFilter])

  const stats = useMemo(() => {
    let totalResult = 0
    let submitted = 0, advDue = 0, advDone = 0, art55Due = 0, art55Done = 0
    filteredRows.forEach(r => {
      if (r.work?.result_amount) totalResult += r.work.result_amount
      if (r.work?.submitted_at) submitted++
      if (advanceRelevance(r.advance, month) === 'due') {
        advDue++
        if (r.work?.advance_payment_done) advDone++
      }
      if (art55Relevance(r.art55, month) === 'due') {
        art55Due++
        if (r.work?.art55_declared) art55Done++
      }
    })
    return { totalResult, submitted, advDue, advDone, art55Due, art55Done, total: filteredRows.length }
  }, [filteredRows, month])

  function changeMonth(delta: number) {
    let m = month + delta
    let y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setMonth(m)
    setYear(y)
  }

  async function patchRow(clientId: string, patch: Partial<MonthlyWork>) {
    // Оптимистичен update
    setRows(prev => {
      const next = new Map(prev)
      const existing = next.get(clientId)
      next.set(clientId, { ...(existing ?? { client_id: clientId, year, month } as MonthlyWork), ...patch })
      return next
    })
    setSavingFor(prev => new Set(prev).add(clientId))
    try {
      await upsertMonthlyWorkByKey(clientId, year, month, patch, user?.id)
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
      await loadAll()
    } finally {
      setSavingFor(prev => {
        const next = new Set(prev)
        next.delete(clientId)
        return next
      })
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] md:h-screen">
      {/* Title bar */}
      <div className="px-3 py-2 md:px-5 md:py-3 flex items-center justify-between border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <h1 className="text-base md:text-lg font-semibold text-foreground">📋 Работен лист</h1>
          <div className="flex items-center gap-1 ml-2">
            <Button variant="outline" size="sm" onClick={() => changeMonth(-1)}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="px-3 py-1 text-sm font-semibold text-foreground min-w-[160px] text-center">
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <Button variant="outline" size="sm" onClick={() => changeMonth(1)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth() + 1) }}>
              Днес
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Търси фирма..."
              className="h-8 pl-8 w-44 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Status filter + summary strip */}
      <div className="px-3 md:px-5 py-2 border-b border-border bg-card flex flex-wrap items-center gap-3 text-xs">
        <span className="text-muted-foreground uppercase tracking-wider font-semibold">Статус:</span>
        {statusOptions.map(s => {
          const active = statusFilter.includes(s)
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(prev => active ? prev.filter(x => x !== s) : [...prev, s])}
              className={`px-2 py-0.5 rounded-full font-semibold transition ${
                active ? (STATUS_BADGE[s] ?? 'bg-muted text-foreground') : 'bg-muted/40 text-muted-foreground hover:bg-muted'
              }`}
            >
              {s}
            </button>
          )
        })}
        {statusFilter.length > 0 && (
          <button onClick={() => setStatusFilter([])} className="text-muted-foreground hover:text-foreground">
            (изчисти)
          </button>
        )}

        <div className="ml-auto flex items-center gap-4">
          <span><strong className="text-foreground">{stats.total}</strong> клиента</span>
          <span>Резултат: <strong className="text-green-600">{formatCurrency(stats.totalResult)} €</strong></span>
          <span>Подадени: <strong className="text-foreground">{stats.submitted}/{stats.total}</strong></span>
          {stats.advDue > 0 && (
            <span title="Авансови вноски — дължими този месец">Аванс: <strong className={stats.advDone === stats.advDue ? 'text-emerald-600' : 'text-amber-600'}>{stats.advDone}/{stats.advDue}</strong></span>
          )}
          {stats.art55Due > 0 && (
            <span title="Чл. 55 декларации — дължими този месец">Чл. 55: <strong className={stats.art55Done === stats.art55Due ? 'text-emerald-600' : 'text-indigo-600'}>{stats.art55Done}/{stats.art55Due}</strong></span>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-6 text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Зареждане...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">Няма съвпадения</div>
        ) : (
          <table className="w-full border-collapse min-w-[1600px]">
            <thead className="bg-navy text-white sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap w-10">#</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap sticky left-0 bg-navy z-20">Фирма</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Статус</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap" title="Приоритетно подаване на ДДС">Приор. ДДС</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider whitespace-nowrap">Резултат €</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Подадено на</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Уведомени</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Несъотв. НАП</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap" title="Авансова вноска корпоративен данък">Аванс. вн.</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap" title="Декларация чл. 55 ЗДДФЛ">Чл. 55</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">ДДС осчет</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">Амор</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">Банка</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">Заплати</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Бележки</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, i) => {
                const w = row.work
                const isSaving = savingFor.has(row.client.id)
                const evenBg = i % 2 === 0 ? 'bg-card' : 'bg-muted/20'
                return (
                  <tr key={row.client.id} className={`border-b border-light/50 hover:bg-gold/5 transition-colors ${evenBg}`}>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground/70 text-right">{i + 1}</td>
                    <td className={`px-3 py-1.5 font-medium text-foreground whitespace-nowrap sticky left-0 z-10 ${evenBg}`}>
                      {row.name || <span className="text-muted-foreground/40 italic">(без име)</span>}
                      {isSaving && <Loader2 className="inline ml-1 h-3 w-3 animate-spin text-muted-foreground" />}
                    </td>
                    <td className="px-3 py-1.5">
                      {row.status && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${STATUS_BADGE[row.status] ?? 'bg-muted text-foreground'}`}>
                          {row.status}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <input type="checkbox" disabled={!canEdit}
                        checked={!!w?.priority_vat}
                        onChange={e => patchRow(row.client.id, { priority_vat: e.target.checked })}
                        className="h-4 w-4 cursor-pointer accent-amber-500" />
                    </td>
                    <td className="px-2 py-0.5 text-right">
                      <NumberCell
                        value={w?.result_amount ?? null}
                        disabled={!canEdit}
                        onSave={v => patchRow(row.client.id, { result_amount: v })}
                      />
                    </td>
                    <td className="px-2 py-0.5">
                      <input type="date" disabled={!canEdit}
                        value={w?.submitted_at ?? ''}
                        onChange={e => patchRow(row.client.id, { submitted_at: e.target.value || null })}
                        className="h-7 px-1 text-xs border border-transparent hover:border-border focus:border-primary rounded bg-transparent w-32" />
                    </td>
                    <td className="px-2 py-0.5">
                      <select disabled={!canEdit}
                        value={w?.notification_method ?? ''}
                        onChange={e => patchRow(row.client.id, { notification_method: e.target.value || null })}
                        className="h-7 px-1 text-xs border border-transparent hover:border-border focus:border-primary rounded bg-transparent">
                        <option value=""></option>
                        {NOTIFICATION_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-0.5">
                      <TextCell
                        value={w?.npa_inconsistencies ?? ''}
                        disabled={!canEdit}
                        onSave={v => patchRow(row.client.id, { npa_inconsistencies: v || null })}
                        placeholder="—"
                        className="w-40"
                      />
                    </td>
                    <PeriodicCell
                      relevance={advanceRelevance(row.advance, month)}
                      deadline={advanceDeadline(row.advance, month)}
                      checked={!!w?.advance_payment_done}
                      disabled={!canEdit}
                      onChange={v => patchRow(row.client.id, { advance_payment_done: v })}
                      accent="amber"
                    />
                    <PeriodicCell
                      relevance={art55Relevance(row.art55, month)}
                      deadline={art55Deadline(row.art55, month)}
                      checked={!!w?.art55_declared}
                      disabled={!canEdit}
                      onChange={v => patchRow(row.client.id, { art55_declared: v })}
                      accent="indigo"
                    />
                    {(['vat_accounted', 'amortization_done', 'bank_done', 'salaries_done'] as const).map(field => (
                      <td key={field} className="px-2 py-1.5 text-center">
                        <input type="checkbox" disabled={!canEdit}
                          checked={!!w?.[field]}
                          onChange={e => patchRow(row.client.id, { [field]: e.target.checked } as Partial<MonthlyWork>)}
                          className="h-4 w-4 cursor-pointer accent-emerald-600" />
                      </td>
                    ))}
                    <td className="px-2 py-0.5">
                      <TextCell
                        value={w?.notes ?? ''}
                        disabled={!canEdit}
                        onSave={v => patchRow(row.client.id, { notes: v || null })}
                        placeholder="—"
                        className="w-48"
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

function PeriodicCell({ relevance, deadline, checked, disabled, onChange, accent }: {
  relevance: Relevance
  deadline: string | null
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
  accent: 'amber' | 'indigo'
}) {
  if (relevance === 'na') {
    return <td className="px-2 py-1.5 text-center text-muted-foreground/30 text-xs">—</td>
  }
  const isDue = relevance === 'due'
  const ringCls = isDue
    ? (accent === 'amber'
        ? 'bg-amber-50 dark:bg-amber-900/20 ring-1 ring-amber-300 dark:ring-amber-700/50'
        : 'bg-indigo-50 dark:bg-indigo-900/20 ring-1 ring-indigo-300 dark:ring-indigo-700/50')
    : 'bg-muted/30'
  const accentCls = accent === 'amber' ? 'accent-amber-500' : 'accent-indigo-600'
  return (
    <td className="px-1 py-1 text-center">
      <div className={`rounded px-1 py-0.5 inline-flex flex-col items-center gap-0.5 ${ringCls}`}>
        <input type="checkbox" disabled={disabled}
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          className={`h-4 w-4 cursor-pointer ${accentCls}`} />
        {isDue && deadline && (
          <span className={`text-[9px] font-semibold leading-none ${accent === 'amber' ? 'text-amber-700 dark:text-amber-300' : 'text-indigo-700 dark:text-indigo-300'}`}>
            {deadline}
          </span>
        )}
      </div>
    </td>
  )
}

function NumberCell({ value, onSave, disabled }: { value: number | null; onSave: (v: number | null) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState(value?.toString() ?? '')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { setDraft(value?.toString() ?? '') }, [value])
  function commit() {
    const v = draft.trim()
    if (v === '' || v === (value?.toString() ?? '')) { setDraft(value?.toString() ?? ''); return }
    const num = parseFloat(v.replace(',', '.'))
    if (!isNaN(num)) onSave(num)
    else setDraft(value?.toString() ?? '')
  }
  return (
    <input
      ref={ref}
      disabled={disabled}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') ref.current?.blur(); if (e.key === 'Escape') { setDraft(value?.toString() ?? ''); ref.current?.blur() } }}
      placeholder="0"
      className="h-7 px-1 text-xs text-right border border-transparent hover:border-border focus:border-primary rounded bg-transparent w-24 tabular-nums"
    />
  )
}

function TextCell({ value, onSave, disabled, placeholder, className }: { value: string; onSave: (v: string) => void; disabled?: boolean; placeholder?: string; className?: string }) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { setDraft(value) }, [value])
  function commit() {
    if (draft === value) return
    onSave(draft)
  }
  return (
    <input
      ref={ref}
      disabled={disabled}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') ref.current?.blur(); if (e.key === 'Escape') { setDraft(value); ref.current?.blur() } }}
      placeholder={placeholder}
      className={`h-7 px-1 text-xs border border-transparent hover:border-border focus:border-primary rounded bg-transparent ${className ?? ''}`}
    />
  )
}
