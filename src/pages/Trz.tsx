import { useState, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Search, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '../lib/auth'
import {
  getClients, getColumns, getCellValues, getDropdownOptions,
  getTrzWork, ensureTrzRows, upsertTrzWorkByKey,
} from '../lib/storage'
import type { Column, CellValue, Client, DropdownOption, TrzWork } from '../lib/types'
import {
  buildCellIndex, buildDropdownIndex, cellKey,
  clientDisplayName, resolveDropdownText, resolveText,
} from '../lib/tableIndices'
import { statusBadgeClass, isHiddenStatus } from '../lib/statusBadge'
import { useRealtime } from '../lib/useRealtime'

const MONTH_NAMES = [
  'Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни',
  'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември',
]

const uc = (s: string) => s.toUpperCase()
const today = () => new Date().toISOString().slice(0, 10)

function formatDate(v: string | null | undefined): string {
  if (!v) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (m) return `${m[3]}.${m[2]}.${m[1]}`
  return v
}

export function TrzPage() {
  const { user } = useAuth()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const [allClients, setAllClients] = useState<Client[]>([])
  const [allColumns, setAllColumns] = useState<Column[]>([])
  const [allCells, setAllCells] = useState<CellValue[]>([])
  const [allDropdowns, setAllDropdowns] = useState<DropdownOption[]>([])
  const [rows, setRows] = useState<Map<string, TrzWork>>(new Map())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [softwareFilter, setSoftwareFilter] = useState<string[]>([])
  const [savingFor, setSavingFor] = useState<Set<string>>(new Set())

  const canEdit = !!user
  const lastEditRef = useRef(0)

  useEffect(() => { void loadAll() }, [year, month])

  useRealtime({
    channel: 'trz',
    tables: ['crm_trz_work', 'crm_cell_values', 'crm_clients'],
    onChange: () => loadAll(true),
    shouldDefer: () => Date.now() - lastEditRef.current < 3000,
  })

  async function loadAll(silent = false) {
    if (!silent) setLoading(true)
    try {
      const [cls, cols, cells, dds] = await Promise.all([
        getClients(), getColumns(), getCellValues(), getDropdownOptions()
      ])
      setAllClients(cls)
      setAllColumns(cols)
      setAllCells(cells)
      setAllDropdowns(dds)

      // Подсигуряваме ред за всеки активен клиент (без „Без дейност"/„Без ДДС").
      const statusColLocal = cols.find(c => c.name === 'Статус')
      const localCellIdx = buildCellIndex(cells)
      const localDropdownIdx = buildDropdownIndex(dds)
      const activeIds = cls
        .filter(c => !isHiddenStatus(resolveDropdownText(c.id, statusColLocal, localCellIdx, localDropdownIdx)))
        .map(c => c.id)
      const created = await ensureTrzRows(activeIds, year, month, user?.id)
      if (created > 0 && !silent) toast.info(`Създадени ${created} нови реда за ${MONTH_NAMES[month - 1]} ${year}`)

      const work = await getTrzWork(year, month)
      setRows(new Map(work.map(w => [w.client_id, w])))
    } catch (e: any) {
      if (!silent) toast.error(e.message ?? 'Грешка при зареждане')
    }
    if (!silent) setLoading(false)
  }

  function changeMonth(delta: number) {
    let m = month + delta
    let y = year
    if (m < 1) { m = 12; y -= 1 }
    else if (m > 12) { m = 1; y += 1 }
    setMonth(m)
    setYear(y)
  }

  const cellIdx = useMemo(() => buildCellIndex(allCells), [allCells])
  const dropdownIdx = useMemo(() => buildDropdownIndex(allDropdowns), [allDropdowns])

  const statusCol = useMemo(() => allColumns.find(c => c.name === 'Статус'), [allColumns])
  const trzRespCol = useMemo(() => allColumns.find(c => {
    const n = uc(c.name)
    return n.includes('ТРЗ') && !n.includes('СТАТУС') && !n.includes('СОФТУЕР')
  }), [allColumns])
  const trzStatusCol = useMemo(() => allColumns.find(c => {
    const n = uc(c.name)
    return n.includes('ТРЗ') && n.includes('СТАТУС')
  }), [allColumns])
  const softwareCol = useMemo(() => allColumns.find(c => uc(c.name).includes('СОФТУЕР')), [allColumns])

  function clientName(clientId: string): string {
    return clientDisplayName(clientId, allColumns, cellIdx) || clientId.slice(0, 8)
  }

  function valueText(col: Column | undefined, clientId: string): string {
    if (!col) return ''
    if (col.type === 'dropdown') return resolveDropdownText(clientId, col, cellIdx, dropdownIdx)
    return resolveText(clientId, col, cellIdx)
  }

  const statusOptions = useMemo(() => {
    if (!trzStatusCol) return [] as string[]
    return [...new Set(allDropdowns.filter(d => d.column_id === trzStatusCol.id).map(d => d.value))]
  }, [allDropdowns, trzStatusCol])

  const softwareOptions = useMemo(() => {
    if (!softwareCol) return [] as string[]
    return [...new Set(allDropdowns.filter(d => d.column_id === softwareCol.id).map(d => d.value))]
  }, [allDropdowns, softwareCol])

  const hasFilters = search.trim() !== '' || statusFilter.length > 0 || softwareFilter.length > 0

  function clearFilters() {
    setSearch('')
    setStatusFilter([])
    setSoftwareFilter([])
  }

  type TrzRow = { client: Client; name: string; status: string; resp: string; software: string; generalStatus: string; work: TrzWork | undefined }
  const tableRows: TrzRow[] = useMemo(() => {
    return allClients
      .map(c => ({
        client: c,
        name: clientDisplayName(c.id, allColumns, cellIdx),
        status: valueText(trzStatusCol, c.id),
        resp: valueText(trzRespCol, c.id),
        software: valueText(softwareCol, c.id),
        generalStatus: resolveDropdownText(c.id, statusCol, cellIdx, dropdownIdx),
        work: rows.get(c.id),
      }))
      .filter(r => !isHiddenStatus(r.generalStatus))
      .sort((a, b) => (a.name || a.client.id).localeCompare(b.name || b.client.id, 'bg'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allClients, allColumns, cellIdx, dropdownIdx, statusCol, trzStatusCol, trzRespCol, softwareCol, rows])

  const filteredRows = useMemo(() => {
    return tableRows.filter(r => {
      if (search.trim() && !(r.name || '').toLowerCase().includes(search.trim().toLowerCase())) return false
      if (statusFilter.length > 0 && !statusFilter.includes(r.status)) return false
      if (softwareFilter.length > 0 && !softwareFilter.includes(r.software)) return false
      return true
    })
  }, [tableRows, search, statusFilter, softwareFilter])

  async function patchRow(clientId: string, patch: Partial<TrzWork>) {
    lastEditRef.current = Date.now()
    setRows(prev => {
      const next = new Map(prev)
      const existing = next.get(clientId)
      next.set(clientId, { ...(existing ?? { client_id: clientId, year, month } as TrzWork), ...patch })
      return next
    })
    setSavingFor(prev => new Set(prev).add(clientId))
    try {
      await upsertTrzWorkByKey(clientId, year, month, patch, user?.id)
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

  // Чекбокс, който при включване попълва датата с днешна (ако е празна).
  function toggleWithDate(clientId: string, work: TrzWork | undefined, boolField: keyof TrzWork, dateField: keyof TrzWork, checked: boolean) {
    const patch: Partial<TrzWork> = { [boolField]: checked } as Partial<TrzWork>
    const currentDate = (work?.[dateField] as string | null | undefined) ?? null
    if (checked && !currentDate) (patch as any)[dateField] = today()
    patchRow(clientId, patch)
  }

  if (loading) return <div className="p-6 text-dark/50">Зареждане...</div>

  const isFiltered = hasFilters && filteredRows.length !== tableRows.length
  const doneCount = filteredRows.filter(r => r.work?.salaries_prepared && r.work?.insurance_submitted && r.work?.payroll_sent).length

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] md:h-screen">
      {/* Title bar */}
      <div className="px-3 py-2 md:px-5 md:py-3 flex items-center justify-between border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <h1 className="text-base md:text-lg font-semibold text-foreground">🧾 ТРЗ</h1>
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
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Търси фирма..."
              className="h-8 pl-8 pr-3 w-44"
            />
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
              <X className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Изчисти</span>
            </Button>
          )}
        </div>
      </div>

      {/* Filter strip */}
      <div className="px-3 md:px-5 py-2 border-b border-border bg-card flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        {statusOptions.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground uppercase tracking-wider font-semibold">ТРЗ Статус:</span>
            {statusOptions.map(s => {
              const active = statusFilter.includes(s)
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(prev => active ? prev.filter(x => x !== s) : [...prev, s])}
                  className={`px-2 py-0.5 rounded-full font-semibold transition ${
                    active ? statusBadgeClass(s) : 'bg-muted/40 text-muted-foreground hover:bg-muted'
                  }`}
                >{s}</button>
              )
            })}
          </div>
        )}
        {softwareOptions.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground uppercase tracking-wider font-semibold">Софтуер:</span>
            {softwareOptions.map(s => {
              const active = softwareFilter.includes(s)
              return (
                <button
                  key={s}
                  onClick={() => setSoftwareFilter(prev => active ? prev.filter(x => x !== s) : [...prev, s])}
                  className={`px-2 py-0.5 rounded-full font-semibold transition ${
                    active ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300' : 'bg-muted/40 text-muted-foreground hover:bg-muted'
                  }`}
                >{s}</button>
              )
            })}
          </div>
        )}
        <div className="ml-auto text-muted-foreground">
          Готови: <span className="font-semibold text-foreground">{doneCount}</span> / {filteredRows.length}
          {isFiltered && <> (от {tableRows.length})</>}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="bg-navy text-white sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap w-10">#</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Фирма</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">ТРЗ</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">ТРЗ Статус</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Софтуер</th>
              <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">Заплати</th>
              <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">Осигуровки</th>
              <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">Ведомост</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-dark/40">
                  {hasFilters ? 'Няма клиенти отговарящи на филтрите' : 'Няма клиенти'}
                </td>
              </tr>
            )}
            {filteredRows.map((r, i) => {
              const w = r.work
              const isSaving = savingFor.has(r.client.id)
              return (
                <tr
                  key={r.client.id}
                  className={`border-b border-light/50 ${i % 2 === 0 ? 'bg-card' : 'bg-muted/20'} hover:bg-gold/5 transition-colors`}
                >
                  <td className="px-3 py-2 text-dark/30 text-xs text-right tabular-nums w-10">
                    {isSaving ? <Loader2 className="h-3 w-3 animate-spin inline" /> : i + 1}
                  </td>
                  <td className="px-3 py-1.5 font-medium text-foreground whitespace-nowrap">{r.name || r.client.id.slice(0, 8)}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {r.resp || <span className="text-dark/20">—</span>}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {r.status
                      ? <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${statusBadgeClass(r.status)}`}>{r.status}</span>
                      : <span className="text-dark/20">—</span>}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {r.software || <span className="text-dark/20">—</span>}
                  </td>

                  {/* Изготвени заплати — чекбокс */}
                  <td className="px-3 py-1.5 text-center">
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={w?.salaries_prepared ?? false}
                      onChange={e => patchRow(r.client.id, { salaries_prepared: e.target.checked })}
                      className="h-4 w-4 cursor-pointer accent-emerald-600"
                    />
                  </td>

                  {/* Подадени осигуровки — чекбокс + дата */}
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-center gap-2">
                      <input
                        type="checkbox"
                        disabled={!canEdit}
                        checked={w?.insurance_submitted ?? false}
                        onChange={e => toggleWithDate(r.client.id, w, 'insurance_submitted', 'insurance_submitted_at', e.target.checked)}
                        className="h-4 w-4 cursor-pointer accent-emerald-600"
                      />
                      <input
                        type="date"
                        disabled={!canEdit}
                        value={w?.insurance_submitted_at ?? ''}
                        onChange={e => patchRow(r.client.id, { insurance_submitted_at: e.target.value || null })}
                        className="h-7 px-1 text-xs border border-border rounded bg-background"
                      />
                    </div>
                  </td>

                  {/* Изпратена ведомост — чекбокс + дата */}
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-center gap-2">
                      <input
                        type="checkbox"
                        disabled={!canEdit}
                        checked={w?.payroll_sent ?? false}
                        onChange={e => toggleWithDate(r.client.id, w, 'payroll_sent', 'payroll_sent_at', e.target.checked)}
                        className="h-4 w-4 cursor-pointer accent-emerald-600"
                      />
                      <input
                        type="date"
                        disabled={!canEdit}
                        value={w?.payroll_sent_at ?? ''}
                        onChange={e => patchRow(r.client.id, { payroll_sent_at: e.target.value || null })}
                        className="h-7 px-1 text-xs border border-border rounded bg-background"
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-navy/5 border-t-2 border-light font-semibold">
            <tr>
              <td className="px-3 py-2 text-dark/30 text-xs text-right tabular-nums">{filteredRows.length}</td>
              <td className="px-3 py-1.5 text-foreground" colSpan={7}>
                Общо {isFiltered && <span className="text-xs font-normal text-muted-foreground">({filteredRows.length} от {tableRows.length})</span>}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
