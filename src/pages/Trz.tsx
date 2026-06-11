import { useState, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Search, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '../lib/auth'
import {
  getClients, getColumns, getCellValues, getDropdownOptions, getStaff,
  getTrzWork, ensureTrzRows, upsertTrzWorkByKey,
} from '../lib/storage'
import type { Column, CellValue, Client, DropdownOption, TrzWork } from '../lib/types'
import {
  buildCellIndex, buildDropdownIndex,
  clientDisplayName, resolveDropdownText, resolveCellText,
} from '../lib/tableIndices'
import { statusBadgeClass } from '../lib/statusBadge'
import { MONTH_NAMES, previousMonth } from '../lib/utils'
import { TRZ_ACTIVE, findTrzColumns } from '../lib/trz'
import { useRealtime } from '../lib/useRealtime'

const today = () => new Date().toISOString().slice(0, 10)

export function TrzPage() {
  const { user } = useAuth()
  // Дефолтваме на предходен месец — ТРЗ работата винаги е за изминалия месец.
  const initial = previousMonth()
  const [year, setYear] = useState(initial.year)
  const [month, setMonth] = useState(initial.month)

  const [allClients, setAllClients] = useState<Client[]>([])
  const [allColumns, setAllColumns] = useState<Column[]>([])
  const [allCells, setAllCells] = useState<CellValue[]>([])
  const [allDropdowns, setAllDropdowns] = useState<DropdownOption[]>([])
  const [rows, setRows] = useState<Map<string, TrzWork>>(new Map())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [formaFilter, setFormaFilter] = useState<string[]>([])
  const [softwareFilter, setSoftwareFilter] = useState<string[]>([])
  const [respFilter, setRespFilter] = useState('')
  const [respStaff, setRespStaff] = useState<string[]>([])
  const [savingFor, setSavingFor] = useState<Set<string>>(new Set())

  const canEdit = !!user
  const lastEditRef = useRef(0)

  // На първия рендер зареждаме мастер + месец. След това смяната на месец
  // презарежда САМО ТРЗ редовете — без клиенти/колони/клетки.
  const isFirstLoadRef = useRef(true)
  useEffect(() => {
    if (isFirstLoadRef.current) {
      isFirstLoadRef.current = false
      void loadAll()
    } else {
      void loadMonth()
    }
  }, [year, month])

  const deferEdits = () => Date.now() - lastEditRef.current < 3000

  useRealtime({
    channel: 'trz-master',
    tables: ['crm_cell_values', 'crm_clients'],
    onChange: () => loadAll(true),
    shouldDefer: deferEdits,
  })
  useRealtime({
    channel: 'trz-month',
    tables: ['crm_trz_work'],
    onChange: () => loadMonth(true),
    shouldDefer: deferEdits,
  })

  interface MasterData {
    cls: Client[]; cols: Column[]; cells: CellValue[]; dds: DropdownOption[]
  }

  async function loadMaster(): Promise<MasterData> {
    const [cls, cols, cells, dds] = await Promise.all([
      getClients(), getColumns(), getCellValues(), getDropdownOptions(),
    ])
    setAllClients(cls)
    setAllColumns(cols)
    setAllCells(cells)
    setAllDropdowns(dds)

    // ТРЗ отговорник филтър — зависи от мастер колоната, не от месеца.
    const trzCols = findTrzColumns(cols)
    if (trzCols.resp?.staff_department) {
      try {
        const staff = await getStaff(trzCols.resp.staff_department)
        setRespStaff(staff.map(s => s.full_name))
      } catch { setRespStaff([]) }
    } else {
      setRespStaff([])
    }

    return { cls, cols, cells, dds }
  }

  async function loadMonth(silent = false, master?: MasterData) {
    if (!silent) setLoading(true)
    try {
      const m = master ?? { cls: allClients, cols: allColumns, cells: allCells, dds: allDropdowns }
      const trzCols = findTrzColumns(m.cols)
      const localCellIdx = buildCellIndex(m.cells)
      const localDropdownIdx = buildDropdownIndex(m.dds)
      const activeIds = m.cls
        .filter(c => resolveDropdownText(c.id, trzCols.status, localCellIdx, localDropdownIdx) === TRZ_ACTIVE)
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

  async function loadAll(silent = false) {
    if (!silent) setLoading(true)
    try {
      const master = await loadMaster()
      await loadMonth(true, master)
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

  const { status: trzStatusCol, forma: formaCol, resp: trzRespCol, software: softwareCol } =
    useMemo(() => findTrzColumns(allColumns), [allColumns])

  const valueText = (col: Column | undefined, clientId: string) =>
    resolveCellText(clientId, col, cellIdx, dropdownIdx)

  const formaOptions = useMemo(() => {
    if (!formaCol) return [] as string[]
    return [...new Set(allDropdowns.filter(d => d.column_id === formaCol.id).map(d => d.value))]
  }, [allDropdowns, formaCol])

  const softwareOptions = useMemo(() => {
    if (!softwareCol) return [] as string[]
    return [...new Set(allDropdowns.filter(d => d.column_id === softwareCol.id).map(d => d.value))]
  }, [allDropdowns, softwareCol])

  const hasFilters = search.trim() !== '' || formaFilter.length > 0 || softwareFilter.length > 0 || respFilter !== ''

  function clearFilters() {
    setSearch('')
    setFormaFilter([])
    setSoftwareFilter([])
    setRespFilter('')
  }

  type TrzRow = { client: Client; name: string; forma: string; resp: string; software: string; work: TrzWork | undefined }
  const tableRows: TrzRow[] = useMemo(() => {
    return allClients
      .filter(c => valueText(trzStatusCol, c.id) === TRZ_ACTIVE)
      .map(c => ({
        client: c,
        name: clientDisplayName(c.id, allColumns, cellIdx),
        forma: valueText(formaCol, c.id),
        resp: valueText(trzRespCol, c.id),
        software: valueText(softwareCol, c.id),
        work: rows.get(c.id),
      }))
      .sort((a, b) => (a.name || a.client.id).localeCompare(b.name || b.client.id, 'bg'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allClients, allColumns, cellIdx, dropdownIdx, trzStatusCol, formaCol, trzRespCol, softwareCol, rows])

  const respOptions = useMemo(() => {
    // 1) staff-свързана колона → целият персонал на отдела (от мастера)
    if (respStaff.length) return [...respStaff].sort((a, b) => a.localeCompare(b, 'bg'))
    // 2) обикновен dropdown → опциите от мастер колоната
    if (trzRespCol?.type === 'dropdown') {
      const opts = [...new Set(allDropdowns.filter(d => d.column_id === trzRespCol.id).map(d => d.value))]
      if (opts.length) return opts.sort((a, b) => a.localeCompare(b, 'bg'))
    }
    // 3) иначе → наличните стойности
    return [...new Set(tableRows.map(r => r.resp).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'bg'))
  }, [respStaff, trzRespCol, allDropdowns, tableRows])

  const filteredRows = useMemo(() => {
    return tableRows.filter(r => {
      if (search.trim() && !(r.name || '').toLowerCase().includes(search.trim().toLowerCase())) return false
      if (formaFilter.length > 0 && !formaFilter.includes(r.forma)) return false
      if (softwareFilter.length > 0 && !softwareFilter.includes(r.software)) return false
      if (respFilter && r.resp !== respFilter) return false
      return true
    })
  }, [tableRows, search, formaFilter, softwareFilter, respFilter])

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
      await loadMonth()
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
          <h1 className="text-base md:text-lg font-semibold text-foreground">🧾 ТРЗ Работен лист</h1>
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
            <Button variant="ghost" size="sm" onClick={() => { const p = previousMonth(); setYear(p.year); setMonth(p.month) }}>
              Работен месец
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { const d = new Date(); setYear(d.getFullYear()); setMonth(d.getMonth() + 1) }}>
              Календарен месец
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
        {formaOptions.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground uppercase tracking-wider font-semibold">Форма на Осиг.:</span>
            {formaOptions.map(s => {
              const active = formaFilter.includes(s)
              return (
                <button
                  key={s}
                  onClick={() => setFormaFilter(prev => active ? prev.filter(x => x !== s) : [...prev, s])}
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
        {respOptions.length > 0 && (
          <div className="flex items-center gap-1.5 pl-2 border-l border-border">
            <span className="text-muted-foreground uppercase tracking-wider font-semibold">ТРЗ отговорник:</span>
            <select
              value={respFilter}
              onChange={e => setRespFilter(e.target.value)}
              className="h-6 px-1 text-xs border border-border rounded bg-background focus:border-primary"
            >
              <option value="">Всички</option>
              {respOptions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            {respFilter && (
              <button onClick={() => setRespFilter('')} className="text-muted-foreground hover:text-foreground">✕</button>
            )}
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
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap w-[260px]">Фирма</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Форма на Осиг.</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Софтуер</th>
              <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">Заплати</th>
              <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">Осигуровки</th>
              <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">Д1 и Д6</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Бележка</th>
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
                  <td className="px-3 py-1.5 font-medium text-foreground whitespace-nowrap truncate max-w-[260px]" title={r.name || r.client.id}>{r.name || r.client.id.slice(0, 8)}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {r.forma
                      ? <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${statusBadgeClass(r.forma)}`}>{r.forma}</span>
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
                        // Скриваме „дд.мм.гггг г." при празна стойност — само иконата остава.
                        className={`h-7 px-1 text-xs border border-border rounded bg-background ${!w?.insurance_submitted_at ? 'text-transparent' : ''}`}
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
                        // Скриваме „дд.мм.гггг г." при празна стойност — само иконата остава.
                        className={`h-7 px-1 text-xs border border-border rounded bg-background ${!w?.payroll_sent_at ? 'text-transparent' : ''}`}
                      />
                    </div>
                  </td>

                  {/* Бележка — месечна, пренася се от предходния месец */}
                  <td className="px-3 py-1.5">
                    <NoteCell
                      key={`${r.client.id}-${year}-${month}`}
                      value={w?.notes ?? ''}
                      disabled={!canEdit}
                      onSave={v => patchRow(r.client.id, { notes: v || null })}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Бележка — записва се при напускане на полето (onBlur), само ако е променена.
function NoteCell({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  return (
    <input
      type="text"
      disabled={disabled}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onSave(draft) }}
      placeholder="—"
      className="w-full min-w-[320px] h-7 px-2 text-xs border border-border rounded bg-background focus:border-primary focus:outline-none"
    />
  )
}
