import { useEffect, useMemo, useState, useRef } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Search, Loader2, X, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '../lib/auth'
import {
  getClients, getColumns, getCellValues, getDropdownOptions,
  getMonthlyWork, ensureMonthlyRows, upsertMonthlyWorkByKey,
  getArt55EntriesForPeriod, addArt55Entry, updateArt55Entry, deleteArt55Entry,
  getOssAmounts,
} from '../lib/storage'
import { NOTIFICATION_METHODS, ART55_INCOME_TYPES, type MonthlyWork, type Client, type Column, type CellValue, type DropdownOption, type Art55Entry } from '../lib/types'
import {
  buildCellIndex, buildDropdownIndex, clientDisplayName,
  resolveDropdownText, cellKey,
} from '../lib/tableIndices'
import { statusBadgeClass, isHiddenStatus } from '../lib/statusBadge'
import { MONTH_NAMES, previousMonth } from '../lib/utils'
import { useRealtime } from '../lib/useRealtime'

function formatCurrency(v: number | null): string {
  if (v == null) return ''
  return new Intl.NumberFormat('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}

// O(N) helper-ите бяха заменени с tableIndices Map lookup-и (виж по-долу).


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

// masterValue беше O(N) — заменен с resolveDropdownText от tableIndices.

export function WorkSheetPage() {
  const { user } = useAuth()
  // Дефолтваме на предходен месец — счет./ТРЗ винаги се работи месец назад
  // (през юни се прави май).
  const initial = previousMonth()
  const [year, setYear] = useState(initial.year)
  const [month, setMonth] = useState(initial.month)

  const [clients, setClients] = useState<Client[]>([])
  const [columns, setColumns] = useState<Column[]>([])
  const [cells, setCells] = useState<CellValue[]>([])
  const [dropdowns, setDropdowns] = useState<DropdownOption[]>([])
  const [rows, setRows] = useState<Map<string, MonthlyWork>>(new Map())
  const [art55Entries, setArt55Entries] = useState<Map<string, Art55Entry[]>>(new Map())  // key = client_id
  // Сбор от предходните месеци на тримесечието (без текущия) — за ОСС сумата за деклариране.
  const [ossPrior, setOssPrior] = useState<Map<string, number>>(new Map())  // key = client_id
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string[]>([])  // празно = всички
  const [accountantFilter, setAccountantFilter] = useState<string>('')  // празно = всички
  const [respFilter, setRespFilter] = useState<string>('')  // празно = всички
  const [savingFor, setSavingFor] = useState<Set<string>>(new Set())
  const [art55ModalFor, setArt55ModalFor] = useState<{ client: Client; name: string } | null>(null)

  const canEdit = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'employee'

  // На първия рендер зареждаме мастер + месец. След това смяната на месец
  // презарежда САМО месечните данни (не клиенти/колони/клетки — те не
  // зависят от месеца и така спестяваме секунди при ◀ ▶).
  const isFirstLoadRef = useRef(true)
  useEffect(() => {
    if (isFirstLoadRef.current) {
      isFirstLoadRef.current = false
      void loadAll()
    } else {
      void loadMonth()
    }
  }, [year, month])

  // Кога потребителят последно е редактирал — за да не презаписваме полето
  // изпод ръцете му при realtime презареждане.
  const lastEditRef = useRef(0)
  const deferEdits = () => Date.now() - lastEditRef.current < 3000

  // Realtime — промени от колеги се отразяват тихо (без спинър). Разделено
  // на два канала: мастер таблиците (клиенти/клетки) → loadAll; месечните
  // таблици → loadMonth, за да не презареждаме излишно.
  useRealtime({
    channel: 'worksheet-master',
    tables: ['crm_cell_values', 'crm_clients'],
    onChange: () => loadAll(true),
    shouldDefer: deferEdits,
  })
  useRealtime({
    channel: 'worksheet-month',
    tables: ['crm_monthly_work', 'crm_art55_entries'],
    onChange: () => loadMonth(true),
    shouldDefer: deferEdits,
  })

  interface MasterData {
    cls: Client[]; cols: Column[]; cvs: CellValue[]; dds: DropdownOption[]
  }

  async function loadMaster(): Promise<MasterData> {
    const [cls, cols, cvs, dds] = await Promise.all([
      getClients(), getColumns(), getCellValues(), getDropdownOptions(),
    ])
    setClients(cls)
    setColumns(cols)
    setCells(cvs)
    setDropdowns(dds)
    return { cls, cols, cvs, dds }
  }

  async function loadMonth(silent = false, master?: MasterData) {
    if (!silent) setLoading(true)
    try {
      // Ползваме подадения master (при първи зар.) или текущия state (при смяна на месец).
      const m = master ?? { cls: clients, cols: columns, cvs: cells, dds: dropdowns }

      // 1. Уверяваме се, че всеки активен клиент има ред за избрания месец.
      // „Без дейност" / „Без ДДС" се пропускат — те не участват в работата.
      const statusColLocal = m.cols.find(c => c.name === 'Статус')
      const localCellIdx = buildCellIndex(m.cvs)
      const localDropdownIdx = buildDropdownIndex(m.dds)
      const activeIds = m.cls
        .filter(c => !isHiddenStatus(resolveDropdownText(c.id, statusColLocal, localCellIdx, localDropdownIdx)))
        .map(c => c.id)
      const created = await ensureMonthlyRows(activeIds, year, month, user?.id)
      if (created > 0 && !silent) toast.info(`Създадени ${created} нови реда за ${MONTH_NAMES[month - 1]} ${year}`)

      // 2. Зареждаме редовете за избрания месец
      const [work, art55] = await Promise.all([
        getMonthlyWork(year, month),
        getArt55EntriesForPeriod(year, [month]),
      ])
      setRows(new Map(work.map(w => [w.client_id, w])))
      const byClient = new Map<string, Art55Entry[]>()
      art55.forEach(e => {
        const arr = byClient.get(e.client_id) ?? []
        arr.push(e)
        byClient.set(e.client_id, arr)
      })
      setArt55Entries(byClient)

      // ОСС: на последния месец от тримесечието зареждаме предходните 2 месеца
      // за да покажем сборната сума за деклариране. Текущият месец идва live от `rows`.
      if (month % 3 === 0) {
        const oss = await getOssAmounts(year, [month - 2, month - 1])
        const prior = new Map<string, number>()
        oss.forEach(o => {
          prior.set(o.client_id, (prior.get(o.client_id) ?? 0) + (o.oss_amount ?? 0))
        })
        setOssPrior(prior)
      } else {
        setOssPrior(new Map())
      }
    } catch (e: any) {
      if (!silent) toast.error(e.message ?? 'Грешка при зареждане')
    }
    if (!silent) setLoading(false)
  }

  async function loadAll(silent = false) {
    if (!silent) setLoading(true)
    try {
      const master = await loadMaster()
      await loadMonth(true, master)  // вътрешно silent — външният setLoading управлява спинъра
    } catch (e: any) {
      if (!silent) toast.error(e.message ?? 'Грешка при зареждане')
    }
    if (!silent) setLoading(false)
  }

  // O(1) индекси — изграждат се веднъж при промяна на данните и се ползват в render-а.
  const cellIdx = useMemo(() => buildCellIndex(cells), [cells])
  const dropdownIdx = useMemo(() => buildDropdownIndex(dropdowns), [dropdowns])

  const statusCol = useMemo(() => columns.find(c => c.name === 'Статус'), [columns])
  const advanceCol = useMemo(() => columns.find(c => c.name === 'Авансови вноски'), [columns])
  const art55Col = useMemo(() => columns.find(c => c.name === 'Чл. 55 ЗДДФЛ'), [columns])
  const accountantCol = useMemo(() => columns.find(c => c.name === 'Счетоводител'), [columns])
  const respCol = useMemo(() => columns.find(c => c.name === 'Отговорник'), [columns])
  // Master ДА/НЕ флагове → месечни чекбоксове
  const akcizCol = useMemo(() => columns.find(c => c.name === 'АКЦИЗ'), [columns])
  const statistikaCol = useMemo(() => columns.find(c => c.name === 'СТАТИСТИКА'), [columns])
  const intrastatCol = useMemo(() => columns.find(c => c.name === 'Интрастат'), [columns])
  const siddoCol = useMemo(() => columns.find(c => c.name === 'СИДДО'), [columns])
  const ossCol = useMemo(() => columns.find(c => c.name === 'ОСС'), [columns])

  // Счетоводителят може да е staff-свързана колона (value_text) или dropdown.
  function accountantOf(clientId: string): string {
    if (!accountantCol) return ''
    const cell = cellIdx.get(cellKey(clientId, accountantCol.id))
    if (!cell) return ''
    if (cell.value_text) return cell.value_text
    if (cell.value_dropdown) return dropdownIdx.get(cell.value_dropdown)?.value ?? ''
    return ''
  }

  // Отговорник — същата логика (staff-свързана или dropdown).
  function responsibleOf(clientId: string): string {
    if (!respCol) return ''
    const cell = cellIdx.get(cellKey(clientId, respCol.id))
    if (!cell) return ''
    if (cell.value_text) return cell.value_text
    if (cell.value_dropdown) return dropdownIdx.get(cell.value_dropdown)?.value ?? ''
    return ''
  }

  // Списък със стойности на статуса (за филтър). „Без дейност" и „Без ДДС"
  // не се показват — тези клиенти изобщо не участват в Работен лист.
  const statusOptions = useMemo(() => {
    if (!statusCol) return [] as string[]
    return [...new Set(dropdowns.filter(d => d.column_id === statusCol.id).map(d => d.value))]
      .filter(v => !isHiddenStatus(v))
  }, [dropdowns, statusCol])

  // Подготвени клиенти за render: name, status, monthly row
  type Row = {
    client: Client; name: string; status: string; accountant: string; responsible: string
    advance: string; art55: string
    akciz: string; statistika: string; intrastat: string; siddo: string; oss: string
    work: MonthlyWork | undefined
  }
  const tableRows: Row[] = useMemo(() => {
    return clients
      .map(c => ({
        client: c,
        name: clientDisplayName(c.id, columns, cellIdx),
        status: resolveDropdownText(c.id, statusCol, cellIdx, dropdownIdx),
        accountant: accountantOf(c.id),
        responsible: responsibleOf(c.id),
        advance: resolveDropdownText(c.id, advanceCol, cellIdx, dropdownIdx),
        art55: resolveDropdownText(c.id, art55Col, cellIdx, dropdownIdx),
        akciz: resolveDropdownText(c.id, akcizCol, cellIdx, dropdownIdx),
        statistika: resolveDropdownText(c.id, statistikaCol, cellIdx, dropdownIdx),
        intrastat: resolveDropdownText(c.id, intrastatCol, cellIdx, dropdownIdx),
        siddo: resolveDropdownText(c.id, siddoCol, cellIdx, dropdownIdx),
        oss: resolveDropdownText(c.id, ossCol, cellIdx, dropdownIdx),
        work: rows.get(c.id),
      }))
      .filter(r => !isHiddenStatus(r.status))
      .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  }, [clients, columns, cellIdx, dropdownIdx, statusCol, advanceCol, art55Col, accountantCol, respCol, akcizCol, statistikaCol, intrastatCol, siddoCol, ossCol, rows])

  // Списък със счетоводители за филтъра (само присъстващите в таблицата).
  const accountantOptions = useMemo(() => {
    return [...new Set(tableRows.map(r => r.accountant).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'bg'))
  }, [tableRows])

  // Списък с отговорници за филтъра (само присъстващите в таблицата).
  const respOptions = useMemo(() => {
    return [...new Set(tableRows.map(r => r.responsible).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'bg'))
  }, [tableRows])

  const filteredRows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return tableRows.filter(r => {
      if (statusFilter.length > 0 && !statusFilter.includes(r.status)) return false
      if (accountantFilter && r.accountant !== accountantFilter) return false
      if (respFilter && r.responsible !== respFilter) return false
      if (s && !r.name.toLowerCase().includes(s)) return false
      return true
    })
  }, [tableRows, search, statusFilter, accountantFilter, respFilter])

  const stats = useMemo(() => {
    let totalResult = 0
    let submitted = 0, advDue = 0, advDone = 0, art55Due = 0, art55Done = 0
    filteredRows.forEach(r => {
      if (r.work?.result_amount) totalResult += r.work.result_amount
      if (r.work?.submitted_at) submitted++
      if (advanceRelevance(r.advance, month) === 'due') {
        advDue++
        if ((r.work?.advance_payment_amount ?? 0) > 0) advDone++
      }
      if (art55Relevance(r.art55, month) === 'due') {
        art55Due++
        if ((art55Entries.get(r.client.id)?.length ?? 0) > 0) art55Done++
      }
    })
    return { totalResult, submitted, advDue, advDone, art55Due, art55Done, total: filteredRows.length }
  }, [filteredRows, month, art55Entries])

  function changeMonth(delta: number) {
    let m = month + delta
    let y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setMonth(m)
    setYear(y)
  }

  async function patchRow(clientId: string, patch: Partial<MonthlyWork>) {
    lastEditRef.current = Date.now()
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
      await loadMonth()
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
            <Button variant="ghost" size="sm" onClick={() => { const p = previousMonth(); setYear(p.year); setMonth(p.month) }}>
              Работен месец
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { const d = new Date(); setYear(d.getFullYear()); setMonth(d.getMonth() + 1) }}>
              Календарен месец
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
                active ? statusBadgeClass(s) : 'bg-muted/40 text-muted-foreground hover:bg-muted'
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

        {accountantOptions.length > 0 && (
          <div className="flex items-center gap-1.5 pl-2 border-l border-border">
            <span className="text-muted-foreground uppercase tracking-wider font-semibold">Счетоводител:</span>
            <select
              value={accountantFilter}
              onChange={e => setAccountantFilter(e.target.value)}
              className="h-6 px-1 text-xs border border-border rounded bg-background focus:border-primary"
            >
              <option value="">Всички</option>
              {accountantOptions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            {accountantFilter && (
              <button onClick={() => setAccountantFilter('')} className="text-muted-foreground hover:text-foreground">
                ✕
              </button>
            )}
          </div>
        )}

        {respOptions.length > 0 && (
          <div className="flex items-center gap-1.5 pl-2 border-l border-border">
            <span className="text-muted-foreground uppercase tracking-wider font-semibold">Отговорник:</span>
            <select
              value={respFilter}
              onChange={e => setRespFilter(e.target.value)}
              className="h-6 px-1 text-xs border border-border rounded bg-background focus:border-primary"
            >
              <option value="">Всички</option>
              {respOptions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            {respFilter && (
              <button onClick={() => setRespFilter('')} className="text-muted-foreground hover:text-foreground">
                ✕
              </button>
            )}
          </div>
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
          <table className="w-full border-collapse min-w-[2050px]">
            <thead className="bg-navy text-white sticky top-0 z-30">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap w-10">#</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap sticky left-0 bg-navy z-40">Фирма</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Статус</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider whitespace-nowrap">Резултат €</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Подадено на</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Уведомени</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Бележки</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap" title="Авансова вноска корпоративен данък">Аванс. вн.</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap" title="Декларация чл. 55 ЗДДФЛ">Чл. 55</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">ДДС осчет</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">Амор</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">Банка</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">Заплати</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">АКЦИЗ</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">Статист.</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">Интрастат</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">СИДДО</th>
                <th className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider whitespace-nowrap" title="ОСС месечна сума; на края на тримесечието — сума за деклариране">ОСС</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Несъотв. НАП</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, i) => {
                const w = row.work
                const isSaving = savingFor.has(row.client.id)
                // „Подадено на" има стойност → ДДС-то е подадено → редът се
                // оцветява леко в зелено за бърз scan кои са приключени.
                // Запазваме редуването четен/нечетен и за done, и за not-done.
                const isSubmitted = !!w?.submitted_at
                const evenBg = isSubmitted
                  ? (i % 2 === 0 ? 'bg-emerald-50 dark:bg-emerald-950/40' : 'bg-emerald-100/60 dark:bg-emerald-950/30')
                  : (i % 2 === 0 ? 'bg-card' : 'bg-muted/20')
                return (
                  <tr key={row.client.id} className={`border-b border-light/50 hover:bg-gold/5 transition-colors ${evenBg}`}>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground/70 text-right">{i + 1}</td>
                    <td className={`px-3 py-1.5 font-medium text-foreground whitespace-nowrap sticky left-0 z-20 ${evenBg}`}>
                      {row.name || <span className="text-muted-foreground/40 italic">(без име)</span>}
                      {isSaving && <Loader2 className="inline ml-1 h-3 w-3 animate-spin text-muted-foreground" />}
                    </td>
                    <td className="px-3 py-1.5">
                      {row.status && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${statusBadgeClass(row.status)}`}>
                          {row.status}
                        </span>
                      )}
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
                        // Когато няма стойност — скриваме „дд.мм.гггг г." (text-transparent),
                        // иконата на календара остава видима и кликаема.
                        className={`h-7 px-1 text-xs border border-transparent hover:border-border focus:border-primary rounded bg-transparent w-32 ${!w?.submitted_at ? 'text-transparent' : ''}`} />
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
                        value={w?.notes ?? ''}
                        disabled={!canEdit}
                        onSave={v => patchRow(row.client.id, { notes: v || null })}
                        placeholder="—"
                        className="w-48"
                      />
                    </td>
                    <AdvanceAmountCell
                      relevance={advanceRelevance(row.advance, month)}
                      deadline={advanceDeadline(row.advance, month)}
                      amount={w?.advance_payment_amount ?? null}
                      disabled={!canEdit}
                      onChange={v => patchRow(row.client.id, { advance_payment_amount: v })}
                    />
                    <Art55SummaryCell
                      relevance={art55Relevance(row.art55, month)}
                      deadline={art55Deadline(row.art55, month)}
                      entries={art55Entries.get(row.client.id) ?? []}
                      onOpen={() => setArt55ModalFor({ client: row.client, name: row.name })}
                    />
                    {(['vat_accounted', 'amortization_done', 'bank_done', 'salaries_done'] as const).map(field => (
                      <td key={field} className="px-2 py-1.5 text-center">
                        <input type="checkbox" disabled={!canEdit}
                          checked={!!w?.[field]}
                          onChange={e => patchRow(row.client.id, { [field]: e.target.checked } as Partial<MonthlyWork>)}
                          className="h-4 w-4 cursor-pointer accent-emerald-600" />
                      </td>
                    ))}
                    <MasterFlagCell flag={row.akciz} checked={!!w?.akciz_done} disabled={!canEdit}
                      onChange={v => patchRow(row.client.id, { akciz_done: v })} />
                    <MasterFlagCell flag={row.statistika} checked={!!w?.statistika_done} disabled={!canEdit}
                      onChange={v => patchRow(row.client.id, { statistika_done: v })} />
                    <MasterFlagCell flag={row.intrastat} checked={!!w?.intrastat_done} disabled={!canEdit}
                      onChange={v => patchRow(row.client.id, { intrastat_done: v })} />
                    <MasterFlagCell flag={row.siddo} checked={!!w?.siddo_done} disabled={!canEdit}
                      onChange={v => patchRow(row.client.id, { siddo_done: v })} />
                    <OssCell flag={row.oss} amount={w?.oss_amount ?? null} disabled={!canEdit}
                      quarterTotal={month % 3 === 0 ? (ossPrior.get(row.client.id) ?? 0) + (w?.oss_amount ?? 0) : null}
                      onSave={v => patchRow(row.client.id, { oss_amount: v })} />
                    <td className="px-2 py-0.5">
                      <TextCell
                        value={w?.npa_inconsistencies ?? ''}
                        disabled={!canEdit}
                        onSave={v => patchRow(row.client.id, { npa_inconsistencies: v || null })}
                        placeholder="—"
                        className="w-40"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {art55ModalFor && (
        <Art55Modal
          client={art55ModalFor.client}
          clientName={art55ModalFor.name}
          year={year}
          month={month}
          entries={art55Entries.get(art55ModalFor.client.id) ?? []}
          disabled={!canEdit}
          onClose={() => setArt55ModalFor(null)}
          onChanged={async () => {
            const fresh = await getArt55EntriesForPeriod(year, [month])
            const byClient = new Map<string, Art55Entry[]>()
            fresh.forEach(e => {
              const arr = byClient.get(e.client_id) ?? []
              arr.push(e)
              byClient.set(e.client_id, arr)
            })
            setArt55Entries(byClient)
          }}
          createdBy={user?.id}
        />
      )}
    </div>
  )
}

// Месечна отметка за master ДА/НЕ флаг. Ако клиентът е „ДА" → чекбокс;
// иначе пише „не" (сиво) и не е редактируем.
function MasterFlagCell({ flag, checked, disabled, onChange }: {
  flag: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  if (flag !== 'ДА') {
    return <td className="px-2 py-1.5 text-center text-[10px] text-muted-foreground/50">не</td>
  }
  return (
    <td className="px-2 py-1.5 text-center">
      <input type="checkbox" disabled={disabled}
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer accent-emerald-600" />
    </td>
  )
}

// ОСС месечна сума. Само за клиенти с мастер ОСС = ДА. На последния месец
// от тримесечието (quarterTotal !== null) показва сборната сума за деклариране.
function OssCell({ flag, amount, disabled, quarterTotal, onSave }: {
  flag: string
  amount: number | null
  disabled?: boolean
  quarterTotal: number | null
  onSave: (v: number | null) => void
}) {
  if (flag !== 'ДА') {
    return <td className="px-2 py-1.5 text-center text-[10px] text-muted-foreground/50">не</td>
  }
  return (
    <td className="px-2 py-0.5 text-right">
      <NumberCell value={amount} disabled={disabled} onSave={onSave} />
      {quarterTotal !== null && (
        <div className="text-[10px] text-primary font-semibold mt-0.5 whitespace-nowrap"
          title="Сума за деклариране (сбор от тримесечието)">
          Σ {quarterTotal.toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      )}
    </td>
  )
}

function AdvanceAmountCell({ relevance, deadline, amount, disabled, onChange }: {
  relevance: Relevance
  deadline: string | null
  amount: number | null
  disabled?: boolean
  onChange: (v: number | null) => void
}) {
  const [draft, setDraft] = useState(amount?.toString() ?? '')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { setDraft(amount?.toString() ?? '') }, [amount])

  if (relevance === 'na') {
    return <td className="px-2 py-1.5 text-center text-muted-foreground/30 text-xs">—</td>
  }
  function commit() {
    const v = draft.trim()
    if (v === '' && amount == null) return
    if (v === '') { onChange(null); return }
    const num = parseFloat(v.replace(',', '.'))
    if (isNaN(num)) { setDraft(amount?.toString() ?? ''); return }
    if (num === amount) return
    onChange(num)
  }
  const isDue = relevance === 'due'
  const isPaid = (amount ?? 0) > 0
  const ringCls = isDue && !isPaid
    ? 'bg-amber-50 dark:bg-amber-900/20 ring-1 ring-amber-300 dark:ring-amber-700/50'
    : isPaid
      ? 'bg-emerald-50 dark:bg-emerald-900/20'
      : 'bg-muted/20'
  return (
    <td className="px-1 py-1 text-center">
      <div className={`rounded px-1 py-0.5 inline-flex flex-col items-center gap-0.5 ${ringCls}`}>
        <input ref={ref} disabled={disabled}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') ref.current?.blur(); if (e.key === 'Escape') { setDraft(amount?.toString() ?? ''); ref.current?.blur() } }}
          placeholder="—"
          className="h-6 px-1 text-xs text-right border border-transparent hover:border-border focus:border-primary rounded bg-transparent w-20 tabular-nums"
        />
        {isDue && !isPaid && deadline && (
          <span className="text-[9px] font-semibold leading-none text-amber-700 dark:text-amber-300">{deadline}</span>
        )}
      </div>
    </td>
  )
}

function Art55SummaryCell({ relevance, deadline, entries, onOpen }: {
  relevance: Relevance
  deadline: string | null
  entries: Art55Entry[]
  onOpen: () => void
}) {
  if (relevance === 'na') {
    return <td className="px-2 py-1.5 text-center text-muted-foreground/30 text-xs">—</td>
  }
  const sumGross = entries.reduce((s, e) => s + (e.gross_amount ?? 0), 0)
  const sumTax = entries.reduce((s, e) => s + (e.tax_amount ?? 0), 0)
  const isDue = relevance === 'due'
  const has = entries.length > 0
  const ringCls = isDue && !has
    ? 'bg-indigo-50 dark:bg-indigo-900/20 ring-1 ring-indigo-300 dark:ring-indigo-700/50'
    : has
      ? 'bg-emerald-50 dark:bg-emerald-900/20'
      : 'bg-muted/20'
  return (
    <td className="px-1 py-1 text-center">
      <button
        onClick={onOpen}
        className={`rounded px-2 py-1 inline-flex flex-col items-center gap-0.5 hover:brightness-95 transition ${ringCls} min-w-[80px]`}
        title={has ? `${entries.length} запис${entries.length === 1 ? '' : 'а'} — брутно ${formatCurrency(sumGross)}, данък ${formatCurrency(sumTax)}` : 'Добави запис'}
      >
        {has ? (
          <>
            <span className="text-[10px] font-semibold tabular-nums text-foreground">{formatCurrency(sumTax)}</span>
            <span className="text-[9px] text-muted-foreground">{entries.length} зап.</span>
          </>
        ) : (
          <>
            <Plus className="h-3 w-3 text-muted-foreground" />
            {isDue && deadline && (
              <span className="text-[9px] font-semibold leading-none text-indigo-700 dark:text-indigo-300">{deadline}</span>
            )}
          </>
        )}
      </button>
    </td>
  )
}

function Art55Modal({ client, clientName, year, month, entries, disabled, onClose, onChanged, createdBy }: {
  client: Client
  clientName: string
  year: number
  month: number
  entries: Art55Entry[]
  disabled?: boolean
  onClose: () => void
  onChanged: () => Promise<void>
  createdBy?: string
}) {
  const [saving, setSaving] = useState(false)
  async function withSave(fn: () => Promise<void>) {
    setSaving(true)
    try { await fn(); await onChanged() } catch (e: any) { toast.error(e.message ?? 'Грешка') }
    setSaving(false)
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-card border border-border rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">Чл. 55 записи</h2>
            <p className="text-xs text-muted-foreground">{clientName} • {MONTH_NAMES[month - 1]} {year}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Няма записи за този месец.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left py-2">Тип доход</th>
                  <th className="text-right py-2">Брутна сума €</th>
                  <th className="text-right py-2">Данък €</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <Art55EntryRow key={e.id} entry={e} disabled={disabled || saving}
                    onUpdate={p => withSave(() => updateArt55Entry(e.id, p))}
                    onDelete={() => withSave(() => deleteArt55Entry(e.id))}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-semibold text-foreground">
                  <td className="py-2">Общо</td>
                  <td className="text-right py-2 tabular-nums">{formatCurrency(entries.reduce((s, e) => s + e.gross_amount, 0))}</td>
                  <td className="text-right py-2 tabular-nums">{formatCurrency(entries.reduce((s, e) => s + e.tax_amount, 0))}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <Button
            variant="outline" size="sm" disabled={disabled || saving}
            onClick={() => withSave(() => addArt55Entry({ client_id: client.id, year, month, createdBy }).then(() => {}))}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Добави запис
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>Затвори</Button>
        </div>
      </div>
    </div>
  )
}

function Art55EntryRow({ entry, disabled, onUpdate, onDelete }: {
  entry: Art55Entry
  disabled?: boolean
  onUpdate: (p: Partial<Art55Entry>) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [gross, setGross] = useState(entry.gross_amount.toString())
  const [tax, setTax] = useState(entry.tax_amount.toString())
  useEffect(() => { setGross(entry.gross_amount.toString()); setTax(entry.tax_amount.toString()) }, [entry.gross_amount, entry.tax_amount])

  function commitNum(field: 'gross_amount' | 'tax_amount', raw: string) {
    const v = parseFloat(raw.replace(',', '.'))
    const safe = isNaN(v) ? 0 : v
    if (safe === entry[field]) return
    void onUpdate({ [field]: safe } as Partial<Art55Entry>)
  }

  return (
    <tr className="border-b border-border/40 last:border-0">
      <td className="py-1.5 pr-2">
        <select disabled={disabled}
          value={entry.income_type ?? ''}
          onChange={e => onUpdate({ income_type: e.target.value || null })}
          className="h-7 px-1 text-sm border border-transparent hover:border-border focus:border-primary rounded bg-transparent w-32"
        >
          <option value="">—</option>
          {ART55_INCOME_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td className="py-1.5 pr-2 text-right">
        <input disabled={disabled} value={gross}
          onChange={e => setGross(e.target.value)}
          onBlur={() => commitNum('gross_amount', gross)}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="h-7 px-1 text-sm text-right border border-transparent hover:border-border focus:border-primary rounded bg-transparent w-28 tabular-nums"
        />
      </td>
      <td className="py-1.5 pr-2 text-right">
        <input disabled={disabled} value={tax}
          onChange={e => setTax(e.target.value)}
          onBlur={() => commitNum('tax_amount', tax)}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="h-7 px-1 text-sm text-right border border-transparent hover:border-border focus:border-primary rounded bg-transparent w-28 tabular-nums"
        />
      </td>
      <td className="py-1.5 text-right">
        <button disabled={disabled} onClick={onDelete}
          className="text-muted-foreground hover:text-destructive p-1 disabled:opacity-40"
          title="Изтрий запис">
          <X className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
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
      // „—" вместо „0" в placeholder — за да се различава „празно" от реална
      // стойност 0 (има клиенти с истинска 0).
      placeholder="—"
      // Bold при попълнена стойност — числата да изпъкват от празните.
      className={`h-7 px-1 text-xs text-right border border-transparent hover:border-border focus:border-primary rounded bg-transparent w-24 tabular-nums ${value !== null ? 'font-semibold text-foreground' : ''}`}
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
