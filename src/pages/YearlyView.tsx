import { useEffect, useMemo, useState, useRef } from 'react'
import { toast } from 'sonner'
import { Fragment } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '../lib/auth'
import {
  getClients, getColumns, getCellValues, getDropdownOptions,
  getMonthlyWorkForYear, upsertMonthlyWorkByKey, ensureMonthlyRows,
  getArt55EntriesForPeriod, getArt55QuarterStatuses, upsertArt55QuarterStatus,
} from '../lib/storage'
import { NOTIFICATION_METHODS, type MonthlyWork, type Client, type Column, type CellValue, type DropdownOption, type Art55Entry, type Art55QuarterStatus } from '../lib/types'

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

function clientNameOf(clientId: string, columns: Column[], cells: CellValue[]): string {
  for (const col of columns) {
    if (col.type === 'text') {
      const cell = cells.find(cv => cv.client_id === clientId && cv.column_id === col.id)
      if (cell?.value_text) return cell.value_text
    }
  }
  return ''
}

function masterValue(clientId: string, col: Column | undefined, cells: CellValue[], dropdowns: DropdownOption[]): string {
  if (!col) return ''
  const cell = cells.find(cv => cv.client_id === clientId && cv.column_id === col.id)
  if (!cell?.value_dropdown) return ''
  return dropdowns.find(d => d.id === cell.value_dropdown)?.value ?? ''
}

function masterNumber(clientId: string, col: Column | undefined, cells: CellValue[]): number | null {
  if (!col) return null
  const cell = cells.find(cv => cv.client_id === clientId && cv.column_id === col.id)
  return cell?.value_number ?? null
}

export function YearlyViewPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'advance' | 'art55' | 'vat'>('vat')
  const [year, setYear] = useState(new Date().getFullYear())

  const [clients, setClients] = useState<Client[]>([])
  const [columns, setColumns] = useState<Column[]>([])
  const [cells, setCells] = useState<CellValue[]>([])
  const [dropdowns, setDropdowns] = useState<DropdownOption[]>([])
  const [monthlyByClient, setMonthlyByClient] = useState<Map<string, Map<number, MonthlyWork>>>(new Map())
  const [art55ByClientMonth, setArt55ByClientMonth] = useState<Map<string, Map<number, Art55Entry[]>>>(new Map())
  const [art55Statuses, setArt55Statuses] = useState<Map<string, Map<number, Art55QuarterStatus>>>(new Map())
  const [loading, setLoading] = useState(true)

  const canEdit = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'employee'

  useEffect(() => { void loadAll() }, [year])

  async function loadAll() {
    setLoading(true)
    try {
      const [cls, cols, cvs, dds] = await Promise.all([
        getClients(), getColumns(), getCellValues(), getDropdownOptions(),
      ])
      setClients(cls)
      setColumns(cols)
      setCells(cvs)
      setDropdowns(dds)

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
      toast.error(err.message ?? 'Грешка при зареждане')
    }
    setLoading(false)
  }

  const advanceCol = useMemo(() => columns.find(c => c.name === 'Авансови вноски'), [columns])
  const art55Col = useMemo(() => columns.find(c => c.name === 'Чл. 55 ЗДДФЛ'), [columns])
  const advMinCol = useMemo(() => columns.find(c => c.name === 'Аванс. мин. годишна сума'), [columns])

  // Клиенти за всеки таб
  type AdvanceRow = { client: Client; name: string; profile: string; minYearly: number | null; months: Map<number, number | null>; total: number }
  const advanceRows = useMemo(() => {
    const visible = user?.role === 'employee' ? clients.filter(c => c.assigned_to === user.id) : clients
    return visible
      .map(c => {
        const profile = masterValue(c.id, advanceCol, cells, dropdowns)
        if (profile !== 'Месечни' && profile !== 'Тримесечни') return null
        const minYearly = masterNumber(c.id, advMinCol, cells)
        const months = new Map<number, number | null>()
        let total = 0
        for (let m = 1; m <= 12; m++) {
          const amt = monthlyByClient.get(c.id)?.get(m)?.advance_payment_amount ?? null
          months.set(m, amt)
          if (amt) total += amt
        }
        return { client: c, name: clientNameOf(c.id, columns, cells), profile, minYearly, months, total } as AdvanceRow
      })
      .filter((r): r is AdvanceRow => r !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  }, [clients, columns, cells, dropdowns, advanceCol, advMinCol, monthlyByClient, user])

  type Art55Row = {
    client: Client; name: string
    quarters: Map<number, Art55Entry[]>
    statuses: Map<number, Art55QuarterStatus | undefined>
    totalGross: number; totalTax: number
  }
  const art55Rows = useMemo(() => {
    const visible = user?.role === 'employee' ? clients.filter(c => c.assigned_to === user.id) : clients
    return visible
      .map(c => {
        const applies = masterValue(c.id, art55Col, cells, dropdowns)
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
        return { client: c, name: clientNameOf(c.id, columns, cells), quarters, statuses, totalGross, totalTax } as Art55Row
      })
      .filter((r): r is Art55Row => r !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  }, [clients, columns, cells, dropdowns, art55Col, art55ByClientMonth, art55Statuses, user])

  async function patchArt55Status(clientId: string, quarter: number, patch: Partial<Art55QuarterStatus>) {
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
      await loadAll()
    }
  }

  type VatRow = { client: Client; name: string; months: Map<number, number | null>; totalPay: number; totalRefund: number; net: number }
  const vatRows = useMemo(() => {
    const visible = user?.role === 'employee' ? clients.filter(c => c.assigned_to === user.id) : clients
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
        return { client: c, name: clientNameOf(c.id, columns, cells), months, totalPay, totalRefund, net: totalPay - totalRefund } as VatRow
      })
      .filter((r): r is VatRow => r !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  }, [clients, columns, cells, monthlyByClient, user])

  async function patchResult(clientId: string, month: number, amount: number | null) {
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
      await loadAll()
    }
  }

  async function patchAmount(clientId: string, month: number, amount: number | null) {
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
      await loadAll()
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] md:h-screen">
      {/* Header */}
      <div className="px-3 py-2 md:px-5 md:py-3 flex items-center justify-between border-b border-border bg-card">
        <div className="flex items-center gap-3">
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

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-6 text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Зареждане...</div>
        ) : tab === 'advance' ? (
          <AdvanceTable rows={advanceRows} year={year} canEdit={canEdit} onPatch={patchAmount} />
        ) : tab === 'art55' ? (
          <Art55Table rows={art55Rows} year={year} canEdit={canEdit} onPatchStatus={patchArt55Status} />
        ) : (
          <VatTable rows={vatRows} year={year} canEdit={canEdit} onPatch={patchResult} />
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
            <tr key={r.client.id} className={`border-b border-light/50 hover:bg-gold/5 ${evenBg}`}>
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
            <tr key={r.client.id} className={`border-b border-light/50 hover:bg-gold/5 ${evenBg}`}>
              <td className={`px-3 py-1.5 font-medium whitespace-nowrap sticky left-0 z-10 ${evenBg} border-r border-border`}>{r.name}</td>
              {QUARTERS.map(q => {
                const entries = r.quarters.get(q.q) ?? []
                const gross = entries.reduce((s, e) => s + e.gross_amount, 0)
                const tax = entries.reduce((s, e) => s + e.tax_amount, 0)
                const status = r.statuses.get(q.q)
                const hasEntries = entries.length > 0
                return (
                  <Fragment key={q.q}>
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{fmt(gross)}</td>
                    <td className="px-2 py-1 text-right tabular-nums font-semibold">{fmt(tax)}</td>
                    <td className="px-2 py-1 text-center text-xs text-muted-foreground">
                      {entries.length > 0 ? entries.length : '—'}
                    </td>
                    <td className="px-2 py-1 border-r border-border">
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
  if (rows.length === 0) {
    return <div className="p-8 text-center text-muted-foreground">Няма ДДС резултати за {year}. Попълни „Резултат €" в Работен лист.</div>
  }
  const totals = useMemoVat(rows)
  return (
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
          return (
            <tr key={r.client.id} className={`border-b border-light/50 hover:bg-gold/5 ${evenBg}`}>
              <td className={`px-3 py-1 font-medium whitespace-nowrap sticky left-0 z-10 ${evenBg}`}>{r.name}</td>
              {MONTH_SHORT.map((_, m) => {
                const month = m + 1
                const v = r.months.get(month) ?? null
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
