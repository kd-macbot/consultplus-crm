import { useEffect, useMemo, useState, useRef } from 'react'
import { toast } from 'sonner'
import { Fragment } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '../lib/auth'
import {
  getMonthlyWorkForYear, upsertMonthlyWorkByKey, ensureMonthlyRows,
  getArt55EntriesForPeriod, getArt55QuarterStatuses, upsertArt55QuarterStatus,
} from '../lib/storage'
import { useClients, useColumns, useCellValues, useDropdownOptions, useInvalidateCrm } from '../lib/queries'
import { NOTIFICATION_METHODS, ART55_INCOME_TYPES, type MonthlyWork, type Client, type Art55Entry, type Art55QuarterStatus } from '../lib/types'
import {
  buildCellIndex, buildDropdownIndex,
  clientDisplayName, resolveDropdownText, resolveNumber,
} from '../lib/tableIndices'
import { useRealtime } from '../lib/useRealtime'

const MONTH_SHORT = ['Ян', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек']
const QUARTERS: Array<{ q: number; months: [number, number, number]; label: string }> = [
  { q: 1, months: [1, 2, 3], label: 'Q1 (Ян-Мар)' },
  { q: 2, months: [4, 5, 6], label: 'Q2 (Апр-Юни)' },
  { q: 3, months: [7, 8, 9], label: 'Q3 (Юли-Сеп)' },
  { q: 4, months: [10, 11, 12], label: 'Q4 (Окт-Дек)' },
]

function fmt(v: number): string {
  if (v === 0) return ''
  return new Intl.NumberFormat('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}

// O(N) helper-ите бяха заменени с tableIndices Map lookup-и в YearlyViewPage.

export function YearlyViewPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'advance' | 'art55' | 'vat'>('vat')
  // Табовете се mount-ват при първо посещение и остават монтирани → следващите
  // превключвания са мигновени (без повторно изграждане на голямата таблица).
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set(['vat']))
  useEffect(() => {
    setVisitedTabs(prev => prev.has(tab) ? prev : new Set(prev).add(tab))
  }, [tab])
  const [year, setYear] = useState(new Date().getFullYear())

  // Master данните идват от React Query — споделени с Dashboard, Клиенти,
  // Работен лист. При навигация cache hit → мигновено показване.
  const clientsQ = useClients()
  const columnsQ = useColumns()
  const cellsQ = useCellValues()
  const dropdownsQ = useDropdownOptions()
  const { invalidateClients, invalidateCells, invalidateColumns, invalidateDropdowns } = useInvalidateCrm()

  const clients = useMemo(() => clientsQ.data ?? [], [clientsQ.data])
  const columns = useMemo(() => columnsQ.data ?? [], [columnsQ.data])
  const cells = useMemo(() => cellsQ.data ?? [], [cellsQ.data])
  const dropdowns = useMemo(() => dropdownsQ.data ?? [], [dropdownsQ.data])
  const masterReady = !!clientsQ.data && !!columnsQ.data && !!cellsQ.data && !!dropdownsQ.data

  // Годишните данни (monthly + art55 + статуси) остават own state — специфични
  // за тази страница и зависят от year.
  const [monthlyByClient, setMonthlyByClient] = useState<Map<string, Map<number, MonthlyWork>>>(new Map())
  const [art55ByClientMonth, setArt55ByClientMonth] = useState<Map<string, Map<number, Art55Entry[]>>>(new Map())
  const [art55Statuses, setArt55Statuses] = useState<Map<string, Map<number, Art55QuarterStatus>>>(new Map())
  const [yearLoading, setYearLoading] = useState(true)

  const loading = !masterReady || yearLoading

  const canEdit = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'employee'

  // Годишните данни се зареждат при смяна на year (или след като master стане готов).
  useEffect(() => {
    if (!masterReady) return
    void loadYear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, masterReady])

  const lastEditRef = useRef(0)

  const deferEdits = () => Date.now() - lastEditRef.current < 3000

  // Realtime — разделено на два канала: мастер → invalidate RQ кеша;
  // годишните данни → loadYear (без full reload на master).
  useRealtime({
    channel: 'yearly-master',
    tables: ['crm_cell_values', 'crm_clients'],
    onChange: () => {
      invalidateClients()
      invalidateCells()
      invalidateColumns()
      invalidateDropdowns()
    },
    shouldDefer: deferEdits,
  })
  useRealtime({
    channel: 'yearly-year',
    tables: ['crm_monthly_work', 'crm_art55_entries', 'crm_art55_quarter_status'],
    onChange: () => loadYear(true),
    shouldDefer: deferEdits,
  })

  async function loadYear(silent = false) {
    if (!silent) setYearLoading(true)
    try {
      // Зареждаме ВСИЧКИ редове за годината с ЕДНА заявка (WHERE year = X)
      const allRows = await getMonthlyWorkForYear(year)
      const mwMap = new Map<string, Map<number, MonthlyWork>>()
      allRows.forEach(r => {
        if (!mwMap.has(r.client_id)) mwMap.set(r.client_id, new Map())
        mwMap.get(r.client_id)!.set(r.month, r)
      })
      setMonthlyByClient(mwMap)

      const [art55, statuses] = await Promise.all([
        getArt55EntriesForPeriod(year, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
        getArt55QuarterStatuses(year),
      ])
      const statusMap = new Map<string, Map<number, Art55QuarterStatus>>()
      statuses.forEach(s => {
        if (!statusMap.has(s.client_id)) statusMap.set(s.client_id, new Map())
        statusMap.get(s.client_id)!.set(s.quarter, s)
      })
      setArt55Statuses(statusMap)
      const a55Map = new Map<string, Map<number, Art55Entry[]>>()
      art55.forEach(e => {
        if (!a55Map.has(e.client_id)) a55Map.set(e.client_id, new Map())
        const byMonth = a55Map.get(e.client_id)!
        const arr = byMonth.get(e.month) ?? []
        arr.push(e)
        byMonth.set(e.month, arr)
      })
      setArt55ByClientMonth(a55Map)
    } catch (err: any) {
      if (!silent) toast.error(err.message ?? 'Грешка при зареждане')
    }
    if (!silent) setYearLoading(false)
  }

  // O(1) индекси — изграждат се веднъж при промяна на данните.
  const cellIdx = useMemo(() => buildCellIndex(cells), [cells])
  const dropdownIdx = useMemo(() => buildDropdownIndex(dropdowns), [dropdowns])

  const advanceCol = useMemo(() => columns.find(c => c.name === 'Авансови вноски'), [columns])
  const art55Col = useMemo(() => columns.find(c => c.name === 'Чл. 55 ЗДДФЛ'), [columns])
  const advMinCol = useMemo(() => columns.find(c => c.name === 'Аванс. мин. годишна сума'), [columns])

  // Клиенти за всеки таб
  type AdvanceRow = { client: Client; name: string; profile: string; minYearly: number | null; months: Map<number, number | null>; total: number }
  const advanceRows = useMemo(() => {
    const visible = clients
    return visible
      .map(c => {
        const profile = resolveDropdownText(c.id, advanceCol, cellIdx, dropdownIdx)
        if (profile !== 'Месечни' && profile !== 'Тримесечни') return null
        const minYearly = resolveNumber(c.id, advMinCol, cellIdx)
        const months = new Map<number, number | null>()
        let total = 0
        for (let m = 1; m <= 12; m++) {
          const amt = monthlyByClient.get(c.id)?.get(m)?.advance_payment_amount ?? null
          months.set(m, amt)
          if (amt) total += amt
        }
        return { client: c, name: clientDisplayName(c.id, columns, cellIdx), profile, minYearly, months, total } as AdvanceRow
      })
      .filter((r): r is AdvanceRow => r !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  }, [clients, columns, cellIdx, dropdownIdx, advanceCol, advMinCol, monthlyByClient])

  type Art55Row = {
    client: Client; name: string
    quarters: Map<number, Art55Entry[]>
    statuses: Map<number, Art55QuarterStatus | undefined>
    totalGross: number; totalTax: number
  }
  const art55Rows = useMemo(() => {
    const visible = clients
    return visible
      .map(c => {
        const applies = resolveDropdownText(c.id, art55Col, cellIdx, dropdownIdx)
        if (applies !== 'ДА') return null
        const byMonth: Map<number, Art55Entry[]> = art55ByClientMonth.get(c.id) ?? new Map()
        const quarters = new Map<number, Art55Entry[]>()
        const statuses = new Map<number, Art55QuarterStatus | undefined>()
        let totalGross = 0, totalTax = 0
        QUARTERS.forEach(({ q, months }) => {
          const entries: Art55Entry[] = []
          months.forEach(m => {
            const monthEntries = byMonth.get(m) ?? []
            entries.push(...monthEntries)
            monthEntries.forEach(e => { totalGross += e.gross_amount; totalTax += e.tax_amount })
          })
          quarters.set(q, entries)
          statuses.set(q, art55Statuses.get(c.id)?.get(q))
        })
        return { client: c, name: clientDisplayName(c.id, columns, cellIdx), quarters, statuses, totalGross, totalTax } as Art55Row
      })
      .filter((r): r is Art55Row => r !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  }, [clients, columns, cellIdx, dropdownIdx, art55Col, art55ByClientMonth, art55Statuses])

  async function patchArt55Status(clientId: string, quarter: number, patch: Partial<Art55QuarterStatus>) {
    lastEditRef.current = Date.now()
    // Auto-set declared_at when marking declared
    const final: Partial<Art55QuarterStatus> = { ...patch }
    if (patch.declared === true) final.declared_at = final.declared_at ?? new Date().toISOString().slice(0, 10)
    if (patch.declared === false) final.declared_at = null

    setArt55Statuses(prev => {
      const next = new Map(prev)
      const inner = new Map(next.get(clientId) ?? new Map())
      const existing = inner.get(quarter)
      inner.set(quarter, { ...(existing ?? { client_id: clientId, year, quarter, declared: false } as Art55QuarterStatus), ...final })
      next.set(clientId, inner)
      return next
    })
    try {
      await upsertArt55QuarterStatus(clientId, year, quarter, final)
    } catch (err: any) {
      toast.error(err.message ?? 'Грешка при запис')
      await loadYear()
    }
  }

  type VatRow = { client: Client; name: string; months: Map<number, number | null>; totalPay: number; totalRefund: number; net: number }
  const vatRows = useMemo(() => {
    const visible = clients
    return visible
      .map(c => {
        const months = new Map<number, number | null>()
        let totalPay = 0, totalRefund = 0
        let anyValue = false
        for (let m = 1; m <= 12; m++) {
          const v = monthlyByClient.get(c.id)?.get(m)?.result_amount ?? null
          months.set(m, v)
          if (v != null) {
            anyValue = true
            if (v > 0) totalPay += v
            else totalRefund += -v
          }
        }
        if (!anyValue) return null
        return { client: c, name: clientDisplayName(c.id, columns, cellIdx), months, totalPay, totalRefund, net: totalPay - totalRefund } as VatRow
      })
      .filter((r): r is VatRow => r !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  }, [clients, columns, cellIdx, monthlyByClient])

  async function patchResult(clientId: string, month: number, amount: number | null) {
    lastEditRef.current = Date.now()
    await ensureMonthlyRows([clientId], year, month, user?.id)
    setMonthlyByClient(prev => {
      const next = new Map(prev)
      const inner = new Map(next.get(clientId) ?? new Map())
      const existing = inner.get(month)
      inner.set(month, { ...(existing ?? { client_id: clientId, year, month } as MonthlyWork), result_amount: amount })
      next.set(clientId, inner)
      return next
    })
    try {
      await upsertMonthlyWorkByKey(clientId, year, month, { result_amount: amount }, user?.id)
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
      await loadYear()
    }
  }

  async function patchAmount(clientId: string, month: number, amount: number | null) {
    lastEditRef.current = Date.now()
    // Ensure row exists
    await ensureMonthlyRows([clientId], year, month, user?.id)
    setMonthlyByClient(prev => {
      const next = new Map(prev)
      const inner = new Map(next.get(clientId) ?? new Map())
      const existing = inner.get(month)
      inner.set(month, { ...(existing ?? { client_id: clientId, year, month } as MonthlyWork), advance_payment_amount: amount })
      next.set(clientId, inner)
      return next
    })
    try {
      await upsertMonthlyWorkByKey(clientId, year, month, { advance_payment_amount: amount }, user?.id)
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
      await loadYear()
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
      {/* Header */}
      <div className="px-3 py-2 md:px-5 md:py-3 flex flex-wrap gap-y-2 items-center justify-between border-b border-border bg-card">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-base md:text-lg font-semibold text-foreground">📅 Годишен изглед</h1>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setYear(year - 1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
            <span className="px-3 py-1 text-sm font-semibold text-foreground min-w-[80px] text-center">{year}</span>
            <Button variant="outline" size="sm" onClick={() => setYear(year + 1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="sm" onClick={() => setYear(new Date().getFullYear())}>Тази година</Button>
          </div>
        </div>
        <div className="flex bg-muted rounded-md p-0.5">
          <button onClick={() => setTab('vat')}
            className={`px-3 py-1.5 text-sm rounded transition ${tab === 'vat' ? 'bg-card shadow-sm text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'}`}>
            ДДС
          </button>
          <button onClick={() => setTab('advance')}
            className={`px-3 py-1.5 text-sm rounded transition ${tab === 'advance' ? 'bg-card shadow-sm text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'}`}>
            Авансови вноски
          </button>
          <button onClick={() => setTab('art55')}
            className={`px-3 py-1.5 text-sm rounded transition ${tab === 'art55' ? 'bg-card shadow-sm text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'}`}>
            Чл. 55 ЗДДФЛ
          </button>
        </div>
      </div>

      {/* Body — трите таба се монтират веднъж и се скриват с CSS, за да е
          мигновено превключването (без повторно mount на голямата таблица). */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-6 text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Зареждане...</div>
        ) : (
          <>
            {visitedTabs.has('vat') && (
              <div className={tab === 'vat' ? '' : 'hidden'}>
                <VatTable rows={vatRows} year={year} canEdit={canEdit} onPatch={patchResult} />
              </div>
            )}
            {visitedTabs.has('advance') && (
              <div className={tab === 'advance' ? '' : 'hidden'}>
                <AdvanceTable rows={advanceRows} year={year} canEdit={canEdit} onPatch={patchAmount} />
              </div>
            )}
            {visitedTabs.has('art55') && (
              <div className={tab === 'art55' ? '' : 'hidden'}>
                <Art55Table rows={art55Rows} year={year} canEdit={canEdit} onPatchStatus={patchArt55Status} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function AdvanceTable({ rows, year, canEdit, onPatch }: {
  rows: { client: Client; name: string; profile: string; minYearly: number | null; months: Map<number, number | null>; total: number }[]
  year: number
  canEdit: boolean
  onPatch: (clientId: string, month: number, amount: number | null) => Promise<void>
}) {
  if (rows.length === 0) {
    return <div className="p-8 text-center text-muted-foreground">Няма клиенти с авансови вноски. Сложи „Месечни" или „Тримесечни" на клиент в Клиенти таблицата.</div>
  }
  const grandTotal = rows.reduce((s, r) => s + r.total, 0)
  const grandMin = rows.reduce((s, r) => s + (r.minYearly ?? 0), 0)

  return (
    <table className="w-full border-collapse min-w-[1400px] text-sm">
      <thead className="bg-navy text-white sticky top-0 z-10">
        <tr>
          <th className="px-3 py-2 text-left text-xs uppercase tracking-wider whitespace-nowrap sticky left-0 bg-navy z-20">Фирма</th>
          <th className="px-2 py-2 text-center text-xs uppercase tracking-wider whitespace-nowrap">Профил</th>
          {MONTH_SHORT.map((m, i) => (
            <th key={i} className="px-2 py-2 text-right text-xs uppercase tracking-wider whitespace-nowrap">{year}-{String(i + 1).padStart(2, '0')}</th>
          ))}
          <th className="px-3 py-2 text-right text-xs uppercase tracking-wider whitespace-nowrap bg-emerald-700">Общо внесени</th>
          <th className="px-3 py-2 text-right text-xs uppercase tracking-wider whitespace-nowrap bg-amber-700">Мин. годишна</th>
          <th className="px-3 py-2 text-right text-xs uppercase tracking-wider whitespace-nowrap">Остатък</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const evenBg = i % 2 === 0 ? 'bg-card' : 'bg-muted/20'
          const diff = (r.minYearly ?? 0) - r.total
          return (
            <tr key={r.client.id} className={`border-b border-border hover:bg-gold/5 ${evenBg}`}>
              <td className={`px-3 py-1 font-medium whitespace-nowrap sticky left-0 z-10 ${evenBg}`}>{r.name}</td>
              <td className="px-2 py-1 text-center text-xs">
                <span className={`px-1.5 py-0.5 rounded ${r.profile === 'Месечни' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300'}`}>
                  {r.profile === 'Месечни' ? 'Мес.' : 'Трим.'}
                </span>
              </td>
              {MONTH_SHORT.map((_, m) => {
                const month = m + 1
                const isQuarterMonth = r.profile === 'Тримесечни' ? [4, 7, 10].includes(month) : true
                return (
                  <td key={m} className="px-1 py-0.5 text-right">
                    <AmountInput
                      value={r.months.get(month) ?? null}
                      disabled={!canEdit}
                      highlight={isQuarterMonth}
                      onSave={v => onPatch(r.client.id, month, v)}
                    />
                  </td>
                )
              })}
              <td className="px-3 py-1 text-right font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{fmt(r.total)}</td>
              <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">{r.minYearly ? fmt(r.minYearly) : '—'}</td>
              <td className={`px-3 py-1 text-right tabular-nums font-semibold ${diff > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                {r.minYearly == null ? '—' : (diff > 0 ? fmt(diff) : '✓')}
              </td>
            </tr>
          )
        })}
      </tbody>
      <tfoot className="bg-muted/50">
        <tr className="font-semibold border-t-2 border-border">
          <td className="px-3 py-2 sticky left-0 bg-muted/50 z-10">ОБЩО</td>
          <td></td>
          <td colSpan={12}></td>
          <td className="px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{fmt(grandTotal)}</td>
          <td className="px-3 py-2 text-right tabular-nums">{fmt(grandMin)}</td>
          <td className="px-3 py-2 text-right tabular-nums">{fmt(grandMin - grandTotal)}</td>
        </tr>
      </tfoot>
    </table>
  )
}

// Кратки етикети за типовете доход — за компактна разбивка в клетката.
const ART55_SHORT_LABEL: Record<string, string> = {
  'дивидент': 'Див',
  'наем': 'Наем',
  'лихва': 'Лих',
  'хонорар': 'Хон',
  'друго': 'Др',
}

type Art55Breakdown = { type: string; gross: number; tax: number; count: number }

// Групира записите по income_type, подредено по ART55_INCOME_TYPES.
// Връща само типове с ненулева сума (за да не претрупваме клетката).
function groupArt55ByType(entries: Art55Entry[]): Art55Breakdown[] {
  const m = new Map<string, Art55Breakdown>()
  entries.forEach(e => {
    const t = (e.income_type as string | null) || 'друго'
    const acc = m.get(t) ?? { type: t, gross: 0, tax: 0, count: 0 }
    acc.gross += e.gross_amount
    acc.tax += e.tax_amount
    acc.count += 1
    m.set(t, acc)
  })
  return ART55_INCOME_TYPES
    .map(t => m.get(t))
    .filter((b): b is Art55Breakdown => !!b && (b.gross !== 0 || b.tax !== 0))
}

function Art55Table({ rows, year, canEdit, onPatchStatus }: {
  rows: {
    client: Client; name: string
    quarters: Map<number, Art55Entry[]>
    statuses: Map<number, Art55QuarterStatus | undefined>
    totalGross: number; totalTax: number
  }[]
  year: number
  canEdit: boolean
  onPatchStatus: (clientId: string, quarter: number, patch: Partial<Art55QuarterStatus>) => Promise<void>
}) {
  if (rows.length === 0) {
    return <div className="p-8 text-center text-muted-foreground">Няма клиенти с „Чл. 55 ЗДДФЛ = ДА". Записите се добавят от Работен лист (кликни на Чл. 55 клетката).</div>
  }
  return (
    <table className="w-full border-collapse min-w-[1500px] text-sm">
      <thead className="bg-navy text-white sticky top-0 z-10">
        <tr>
          <th rowSpan={2} className="px-3 py-2 text-left text-xs uppercase tracking-wider whitespace-nowrap sticky left-0 bg-navy z-20 border-r border-navy-light">Фирма</th>
          {QUARTERS.map(q => (
            <th key={q.q} colSpan={4} className="px-2 py-2 text-center text-xs uppercase tracking-wider whitespace-nowrap border-r border-navy-light">{q.label}</th>
          ))}
          <th rowSpan={2} className="px-3 py-2 text-right text-xs uppercase tracking-wider whitespace-nowrap bg-emerald-700">Общо данък</th>
        </tr>
        <tr className="bg-navy/90">
          {QUARTERS.map(q => (
            <Fragment key={q.q}>
              <th className="px-2 py-1 text-right text-[10px] uppercase">Бруто</th>
              <th className="px-2 py-1 text-right text-[10px] uppercase">Данък</th>
              <th className="px-2 py-1 text-center text-[10px] uppercase">N</th>
              <th className="px-2 py-1 text-center text-[10px] uppercase border-r border-navy-light">Декл./Плат.</th>
            </Fragment>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const evenBg = i % 2 === 0 ? 'bg-card' : 'bg-muted/20'
          return (
            <tr key={r.client.id} className={`border-b border-border hover:bg-gold/5 ${evenBg}`}>
              <td className={`px-3 py-1.5 font-medium whitespace-nowrap sticky left-0 z-10 ${evenBg} border-r border-border`}>{r.name}</td>
              {QUARTERS.map(q => {
                const entries = r.quarters.get(q.q) ?? []
                const gross = entries.reduce((s, e) => s + e.gross_amount, 0)
                const tax = entries.reduce((s, e) => s + e.tax_amount, 0)
                const status = r.statuses.get(q.q)
                const hasEntries = entries.length > 0
                const breakdown = groupArt55ByType(entries)
                // 0 типа → празна клетка; 1 тип → ред с етикет (без втори ред „общо");
                // 2+ типа → редове по тип + сепаратор + ред с обща сума.
                const showTotalRow = breakdown.length > 1
                return (
                  <Fragment key={q.q}>
                    {/* Бруто — винаги с етикет на типа отляво (вкл. при 1 тип) за консистентност. */}
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground align-top">
                      {breakdown.length === 0 ? (
                        fmt(gross)
                      ) : (
                        <div className="space-y-0.5">
                          {breakdown.map(b => (
                            <div key={b.type} className="flex items-center justify-end gap-1.5 text-[10px] leading-tight">
                              <span className="text-muted-foreground/60">{ART55_SHORT_LABEL[b.type] ?? b.type}</span>
                              <span>{fmt(b.gross)}</span>
                            </div>
                          ))}
                          {showTotalRow && (
                            <div className="border-t border-border/40 pt-0.5 text-xs">{fmt(gross)}</div>
                          )}
                        </div>
                      )}
                    </td>
                    {/* Данък — същата подредба, без етикет (подравнено с Бруто). */}
                    <td className="px-2 py-1 text-right tabular-nums font-semibold align-top">
                      {breakdown.length === 0 ? (
                        fmt(tax)
                      ) : (
                        <div className="space-y-0.5">
                          {breakdown.map(b => (
                            <div key={b.type} className="text-[10px] font-normal leading-tight text-foreground/80">
                              {fmt(b.tax)}
                            </div>
                          ))}
                          {showTotalRow && (
                            <div className="border-t border-border/40 pt-0.5 text-xs">{fmt(tax)}</div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1 text-center text-xs text-muted-foreground align-top">
                      {entries.length > 0 ? entries.length : '—'}
                    </td>
                    <td className="px-2 py-1 border-r border-border align-top">
                      <Art55StatusCell
                        status={status}
                        hasEntries={hasEntries}
                        disabled={!canEdit}
                        onPatch={p => onPatchStatus(r.client.id, q.q, p)}
                      />
                    </td>
                  </Fragment>
                )
              })}
              <td className="px-3 py-1 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">{fmt(r.totalTax)}</td>
            </tr>
          )
        })}
      </tbody>
      <tfoot className="bg-muted/50">
        <tr className="font-semibold border-t-2 border-border">
          <td className="px-3 py-2 sticky left-0 bg-muted/50 z-10 border-r border-border">ОБЩО</td>
          {QUARTERS.map(q => {
            let g = 0, t = 0, n = 0, declared = 0, withEntries = 0
            rows.forEach(r => {
              const entries = r.quarters.get(q.q) ?? []
              entries.forEach(e => { g += e.gross_amount; t += e.tax_amount; n++ })
              if (entries.length > 0) {
                withEntries++
                if (r.statuses.get(q.q)?.declared) declared++
              }
            })
            return (
              <Fragment key={q.q}>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(g)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(t)}</td>
                <td className="px-2 py-2 text-center text-xs">{n}</td>
                <td className="px-2 py-2 text-center text-xs border-r border-border">
                  {withEntries > 0 && (
                    <span className={declared === withEntries ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-600'}>
                      {declared}/{withEntries}
                    </span>
                  )}
                </td>
              </Fragment>
            )
          })}
          <td className="px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{fmt(rows.reduce((s, r) => s + r.totalTax, 0))}</td>
        </tr>
      </tfoot>
    </table>
  )
}

function Art55StatusCell({ status, hasEntries, disabled, onPatch }: {
  status: Art55QuarterStatus | undefined
  hasEntries: boolean
  disabled?: boolean
  onPatch: (patch: Partial<Art55QuarterStatus>) => Promise<void>
}) {
  const declared = status?.declared ?? false
  const method = status?.notification_method ?? ''
  if (!hasEntries && !declared && !method) {
    return <div className="text-center text-muted-foreground/30 text-xs">—</div>
  }
  return (
    <div className="flex flex-col items-center gap-0.5">
      <label className={`inline-flex items-center gap-1 text-[10px] cursor-pointer ${declared ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-muted-foreground'}`}>
        <input
          type="checkbox" disabled={disabled}
          checked={declared}
          onChange={e => onPatch({ declared: e.target.checked })}
          className="h-3 w-3 cursor-pointer accent-emerald-600"
        />
        {declared ? 'ОК' : 'декл.'}
      </label>
      <select
        disabled={disabled}
        value={method}
        onChange={e => onPatch({ notification_method: e.target.value || null })}
        className="h-5 text-[10px] px-0.5 border border-transparent hover:border-border focus:border-primary rounded bg-transparent w-16"
        title="Платеж — уведомени"
      >
        <option value=""></option>
        {NOTIFICATION_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
    </div>
  )
}

function VatTable({ rows, year, canEdit, onPatch }: {
  rows: { client: Client; name: string; months: Map<number, number | null>; totalPay: number; totalRefund: number; net: number }[]
  year: number
  canEdit: boolean
  onPatch: (clientId: string, month: number, amount: number | null) => Promise<void>
}) {
  // Режим „Сумирай": избираш клетки от ЕДИН ред (един клиент) и виждаш сумата
  // само за него. Изборът се ограничава до един клиент — клик в друг ред
  // започва нов избор.
  const [sumMode, setSumMode] = useState(false)
  const [selClient, setSelClient] = useState<string | null>(null)
  const [selMonths, setSelMonths] = useState<Set<number>>(new Set())

  function clickCell(clientId: string, month: number) {
    if (selClient !== clientId) {
      // Нов клиент → започваме нов избор само с този месец.
      setSelClient(clientId)
      setSelMonths(new Set([month]))
      return
    }
    setSelMonths(prev => {
      const next = new Set(prev)
      if (next.has(month)) next.delete(month)
      else next.add(month)
      return next
    })
  }

  function clearSel() { setSelClient(null); setSelMonths(new Set()) }

  // ВАЖНО: всички hooks преди ранния return (rules of hooks).
  const totals = useMemoVat(rows)

  if (rows.length === 0) {
    return <div className="p-8 text-center text-muted-foreground">Няма ДДС резултати за {year}. Попълни „Резултат €" в Работен лист.</div>
  }

  const selRow = selClient ? rows.find(r => r.client.id === selClient) : null
  const selNet = selRow ? [...selMonths].reduce((s, m) => s + (selRow.months.get(m) ?? 0), 0) : 0
  const selLabel = [...selMonths].sort((a, b) => a - b).map(m => MONTH_SHORT[m - 1]).join(' + ')

  return (
    <>
      {/* Toolbar */}
      <div className="px-3 md:px-5 py-2 border-b border-border bg-card flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <button
          onClick={() => { setSumMode(m => !m); clearSel() }}
          className={`px-3 py-1 rounded-md text-xs font-semibold transition ${sumMode ? 'bg-sky-600 text-white' : 'bg-muted text-foreground hover:bg-muted/70'}`}>
          🧮 Сумирай месеци {sumMode ? '(вкл.)' : ''}
        </button>
        {sumMode && !selClient && (
          <span className="text-xs text-muted-foreground">Кликни клетки от един ред, за да ги събереш</span>
        )}
        {sumMode && selRow && (
          <>
            <span className="font-medium text-foreground">{selRow.name}</span>
            <span className="text-muted-foreground">{selLabel || '—'}</span>
            <span className="ml-auto">
              Сума:&nbsp;
              <strong className={selNet >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                {selNet === 0 ? '0,00' : selNet > 0 ? fmt(selNet) : `-${fmt(-selNet)}`} €
              </strong>
              <span className="text-xs text-muted-foreground ml-1">{selNet >= 0 ? '(за внасяне)' : '(за възстановяване)'}</span>
            </span>
            <button onClick={clearSel} className="text-xs text-sky-700 dark:text-sky-300 hover:underline">изчисти</button>
          </>
        )}
      </div>
      <table className="w-full border-collapse min-w-[1400px] text-sm">
        <thead className="bg-navy text-white sticky top-0 z-10">
          <tr>
            <th className="px-3 py-2 text-left text-xs uppercase tracking-wider whitespace-nowrap sticky left-0 bg-navy z-20">Фирма</th>
            {MONTH_SHORT.map((_, i) => (
              <th key={i} className="px-2 py-2 text-right text-xs uppercase tracking-wider whitespace-nowrap">{year}-{String(i + 1).padStart(2, '0')}</th>
            ))}
            <th className="px-3 py-2 text-right text-xs uppercase tracking-wider whitespace-nowrap bg-emerald-700" title="Сума на месеците за внасяне">За внасяне</th>
            <th className="px-3 py-2 text-right text-xs uppercase tracking-wider whitespace-nowrap bg-rose-700" title="Сума на месеците за възстановяване">За възстан.</th>
            <th className="px-3 py-2 text-right text-xs uppercase tracking-wider whitespace-nowrap">Нето</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const evenBg = i % 2 === 0 ? 'bg-card' : 'bg-muted/20'
            const isSelRow = sumMode && selClient === r.client.id
            const rowSelNet = isSelRow ? [...selMonths].reduce((s, m) => s + (r.months.get(m) ?? 0), 0) : 0
            return (
              <tr key={r.client.id} className={`border-b border-border hover:bg-gold/5 ${evenBg} ${isSelRow ? 'ring-1 ring-sky-400' : ''}`}>
                <td className={`px-3 py-1 font-medium whitespace-nowrap sticky left-0 z-10 ${evenBg}`}>
                  {r.name}
                  {isSelRow && selMonths.size > 0 && (
                    <span className={`ml-2 text-xs font-bold ${rowSelNet >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      Σ {rowSelNet > 0 ? fmt(rowSelNet) : rowSelNet < 0 ? `-${fmt(-rowSelNet)}` : '0,00'} €
                    </span>
                  )}
                </td>
                {MONTH_SHORT.map((_, m) => {
                  const month = m + 1
                  const v = r.months.get(month) ?? null
                  const cellSel = isSelRow && selMonths.has(month)
                  if (sumMode) {
                    // В режим Сумирай клетките са кликваеми (не се редактират).
                    const cls = v == null || v === 0
                      ? 'text-muted-foreground/50'
                      : v > 0 ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-rose-700 dark:text-rose-300 font-semibold'
                    return (
                      <td key={m} className="px-1 py-0.5 text-right">
                        <button
                          onClick={() => clickCell(r.client.id, month)}
                          className={`w-20 h-7 px-1.5 text-xs text-right tabular-nums rounded transition ${cellSel ? 'bg-sky-200 dark:bg-sky-800/60 ring-1 ring-sky-500' : 'hover:bg-sky-50 dark:hover:bg-sky-900/20'} ${cls}`}>
                          {v == null ? '—' : v > 0 ? fmt(v) : `-${fmt(-v)}`}
                        </button>
                      </td>
                    )
                  }
                  return (
                    <td key={m} className="px-1 py-0.5 text-right">
                      <VatCell value={v} disabled={!canEdit} onSave={x => onPatch(r.client.id, month, x)} />
                    </td>
                  )
                })}
                <td className="px-3 py-1 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">{fmt(r.totalPay)}</td>
                <td className="px-3 py-1 text-right tabular-nums font-semibold text-rose-600 dark:text-rose-400">{fmt(r.totalRefund)}</td>
                <td className={`px-3 py-1 text-right tabular-nums font-semibold ${r.net >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {r.net === 0 ? '—' : (r.net > 0 ? fmt(r.net) : `-${fmt(-r.net)}`)}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot className="bg-muted/50">
          <tr className="font-semibold border-t-2 border-border">
            <td className="px-3 py-2 sticky left-0 bg-muted/50 z-10">ОБЩО</td>
            {MONTH_SHORT.map((_, m) => {
              const t = totals.months.get(m + 1) ?? { pay: 0, refund: 0 }
              const net = t.pay - t.refund
              return (
                <td key={m} className={`px-2 py-2 text-right tabular-nums ${net > 0 ? 'text-emerald-700 dark:text-emerald-400' : net < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`}>
                  {net === 0 ? '' : net > 0 ? fmt(net) : `-${fmt(-net)}`}
                </td>
              )
            })}
            <td className="px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{fmt(totals.totalPay)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-rose-600 dark:text-rose-400">{fmt(totals.totalRefund)}</td>
            <td className={`px-3 py-2 text-right tabular-nums ${totals.totalPay - totals.totalRefund >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {(() => { const n = totals.totalPay - totals.totalRefund; return n === 0 ? '—' : n > 0 ? fmt(n) : `-${fmt(-n)}` })()}
            </td>
          </tr>
        </tfoot>
      </table>
    </>
  )
}

function useMemoVat(rows: { months: Map<number, number | null>; totalPay: number; totalRefund: number }[]) {
  return useMemo(() => {
    const months = new Map<number, { pay: number; refund: number }>()
    let totalPay = 0, totalRefund = 0
    rows.forEach(r => {
      r.months.forEach((v, m) => {
        if (v == null) return
        const acc = months.get(m) ?? { pay: 0, refund: 0 }
        if (v > 0) acc.pay += v
        else acc.refund += -v
        months.set(m, acc)
      })
      totalPay += r.totalPay
      totalRefund += r.totalRefund
    })
    return { months, totalPay, totalRefund }
  }, [rows])
}

function VatCell({ value, disabled, onSave }: { value: number | null; disabled?: boolean; onSave: (v: number | null) => void }) {
  const [draft, setDraft] = useState(value?.toString() ?? '')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { setDraft(value?.toString() ?? '') }, [value])
  function commit() {
    const v = draft.trim()
    if (v === '' && value == null) return
    if (v === '') { onSave(null); return }
    const num = parseFloat(v.replace(',', '.'))
    if (isNaN(num)) { setDraft(value?.toString() ?? ''); return }
    if (num === value) return
    onSave(num)
  }
  const cls = value == null || value === 0
    ? 'border-transparent bg-transparent text-muted-foreground/60'
    : value > 0
      ? 'border-emerald-300 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300 font-semibold'
      : 'border-rose-300 dark:border-rose-700/60 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 font-semibold'
  const displayDraft = (() => {
    if (draft === '' || value == null) return draft
    const n = parseFloat(draft.replace(',', '.'))
    if (isNaN(n)) return draft
    return n < 0 ? `-${(-n).toString()}` : draft
  })()
  return (
    <input
      ref={ref}
      disabled={disabled}
      value={displayDraft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') ref.current?.blur(); if (e.key === 'Escape') { setDraft(value?.toString() ?? ''); ref.current?.blur() } }}
      placeholder="—"
      title="+ за внасяне, − за възстановяване"
      className={`h-7 px-1.5 text-xs text-right border rounded tabular-nums w-20 transition hover:border-border focus:border-primary focus:bg-card ${cls}`}
    />
  )
}

function AmountInput({ value, disabled, highlight, onSave }: {
  value: number | null
  disabled?: boolean
  highlight?: boolean
  onSave: (v: number | null) => void
}) {
  const [draft, setDraft] = useState(value?.toString() ?? '')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { setDraft(value?.toString() ?? '') }, [value])
  function commit() {
    const v = draft.trim()
    if (v === '' && value == null) return
    if (v === '') { onSave(null); return }
    const num = parseFloat(v.replace(',', '.'))
    if (isNaN(num)) { setDraft(value?.toString() ?? ''); return }
    if (num === value) return
    onSave(num)
  }
  return (
    <input
      ref={ref}
      disabled={disabled}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') ref.current?.blur(); if (e.key === 'Escape') { setDraft(value?.toString() ?? ''); ref.current?.blur() } }}
      placeholder="—"
      className={`h-7 px-1.5 text-xs text-right border rounded tabular-nums w-20 transition
        ${highlight ? 'border-amber-300 dark:border-amber-700/60 bg-amber-50/50 dark:bg-amber-900/10' : 'border-transparent bg-transparent'}
        hover:border-border focus:border-primary focus:bg-card`}
    />
  )
}
