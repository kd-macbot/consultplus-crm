import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Download, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '../lib/auth'
import {
  useClients, useColumns, useCellValues, useDropdownOptions,
  useFinancialClosings, useFinancialSettings, useInvalidateCrm,
} from '../lib/queries'
import { setFinancialPeriodKind } from '../lib/storage'
import type { FinancialClosing, PeriodKind } from '../lib/types'
import { buildCellIndex, buildDropdownIndex, clientDisplayName, resolveDropdownText, cellKey } from '../lib/tableIndices'
import { exportRowsToExcel } from '../lib/export'
import { MONTH_NAMES } from '../lib/utils'
import { useRealtime } from '../lib/useRealtime'
import { usePersistentState } from '../lib/usePersistentState'
import { FinancialClosingModal } from '../components/FinancialClosingModal'

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const QUARTERS = [
  { q: 1, endMonth: 3, label: 'Q1 (Ян–Мар)' },
  { q: 2, endMonth: 6, label: 'Q2 (Апр–Юни)' },
  { q: 3, endMonth: 9, label: 'Q3 (Юли–Сеп)' },
  { q: 4, endMonth: 12, label: 'Q4 (Окт–Дек)' },
]
const MONITOR_COLUMN = 'Мониторинг'

function fmt(v: number): string {
  if (v === 0) return ''
  return new Intl.NumberFormat('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}
function resultOf(c: FinancialClosing | undefined): number | null {
  if (!c) return null
  return c.income - c.expense
}
function colorCls(v: number | null): string {
  if (v == null || v === 0) return 'text-muted-foreground/50'
  return v > 0 ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-rose-600 dark:text-rose-400 font-semibold'
}

// ============================================================
// Приключвания — за фирми с „Мониторинг" = ДА. Показва Резултата
// (Приходи − Разходи) по периоди за годината, зелено/червено, с тренд.
// Периодът е по фирма: месечно (12 клетки) или тримесечно (в края на
// тримесечието). Клик на клетка отваря модал за Приходи/Разходи/бележка.
// ============================================================
export function ClosingsSection({ year, search }: { year: number; search: string }) {
  const { user } = useAuth()
  const clientsQ = useClients()
  const columnsQ = useColumns()
  const cellsQ = useCellValues()
  const dropdownsQ = useDropdownOptions()
  const masterReady = !!clientsQ.data && !!columnsQ.data && !!cellsQ.data && !!dropdownsQ.data

  const closingsQ = useFinancialClosings(year)
  const settingsQ = useFinancialSettings()
  const { invalidateFinancialClosings, invalidateFinancialSettings } = useInvalidateCrm()

  useRealtime({
    channel: 'financial-closings',
    tables: ['crm_financial_closings', 'crm_financial_settings'],
    onChange: () => { invalidateFinancialClosings(); invalidateFinancialSettings() },
  })

  const [modalFor, setModalFor] = useState<{ clientId: string; name: string; kind: PeriodKind; periodNo: number; label: string } | null>(null)

  const canEdit = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'employee'
  const loading = !masterReady || (closingsQ.isLoading && !closingsQ.data)

  const columns = useMemo(() => columnsQ.data ?? [], [columnsQ.data])
  const cellIdx = useMemo(() => buildCellIndex(cellsQ.data ?? []), [cellsQ.data])
  const dropdownIdx = useMemo(() => buildDropdownIndex(dropdownsQ.data ?? []), [dropdownsQ.data])
  const monitorCol = useMemo(() => columns.find(c => c.name === MONITOR_COLUMN), [columns])

  // Настройка на ритъма по клиент (default месечно).
  const kindByClient = useMemo(() => {
    const m = new Map<string, PeriodKind>()
    ;(settingsQ.data ?? []).forEach(s => m.set(s.client_id, s.period_kind))
    return m
  }, [settingsQ.data])

  // client_id → "kind:no" → запис
  const closingsByClient = useMemo(() => {
    const m = new Map<string, Map<string, FinancialClosing>>()
    ;(closingsQ.data ?? []).forEach(c => {
      const inner = m.get(c.client_id) ?? new Map<string, FinancialClosing>()
      inner.set(`${c.period_kind}:${c.period_no}`, c)
      m.set(c.client_id, inner)
    })
    return m
  }, [closingsQ.data])

  type Row = { clientId: string; name: string; kind: PeriodKind; monthResults: (number | null)[]; total: number; trend: number }
  const rows: Row[] = useMemo(() => {
    if (!monitorCol) return []
    const out: Row[] = []
    ;(clientsQ.data ?? []).forEach(cl => {
      // Само фирми с „Мониторинг" = ДА (case-insensitive).
      const flag = resolveDropdownText(cl.id, monitorCol, cellIdx, dropdownIdx).trim().toUpperCase()
      if (flag !== 'ДА') return
      const kind = kindByClient.get(cl.id) ?? 'month'
      const inner = closingsByClient.get(cl.id)
      // Резултат по месец-колона (за тримесечни — само в края на тримесечието).
      const monthResults: (number | null)[] = ALL_MONTHS.map(mo => {
        if (kind === 'month') return resultOf(inner?.get(`month:${mo}`))
        const q = QUARTERS.find(x => x.endMonth === mo)
        return q ? resultOf(inner?.get(`quarter:${q.q}`)) : null
      })
      const periodResults = monthResults.filter((v): v is number => v != null)
      const total = periodResults.reduce((s, v) => s + v, 0)
      // Тренд: последен период спрямо предходния попълнен.
      const trend = periodResults.length >= 2
        ? periodResults[periodResults.length - 1] - periodResults[periodResults.length - 2]
        : 0
      out.push({ clientId: cl.id, name: clientDisplayName(cl.id, columns, cellIdx), kind, monthResults, total, trend })
    })
    return out.sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  }, [clientsQ.data, monitorCol, cellIdx, dropdownIdx, columns, kindByClient, closingsByClient])

  const filteredRows = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return rows
    return rows.filter(r => r.name.toLowerCase().includes(s))
  }, [rows, search])

  const footer = useMemo(() => {
    const perMonth = ALL_MONTHS.map((_, i) =>
      filteredRows.reduce((s, r) => s + (r.monthResults[i] ?? 0), 0))
    const grand = filteredRows.reduce((s, r) => s + r.total, 0)
    return { perMonth, grand }
  }, [filteredRows])

  async function toggleKind(clientId: string, next: PeriodKind) {
    try {
      await setFinancialPeriodKind(clientId, next)
      invalidateFinancialSettings()
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка')
    }
  }

  function openCell(row: Row, monthIdx: number) {
    const mo = monthIdx + 1
    if (row.kind === 'month') {
      setModalFor({ clientId: row.clientId, name: row.name, kind: 'month', periodNo: mo, label: `${MONTH_NAMES[monthIdx]} ${year}` })
    } else {
      const q = QUARTERS.find(x => x.endMonth === mo)
      if (!q) return
      setModalFor({ clientId: row.clientId, name: row.name, kind: 'quarter', periodNo: q.q, label: `${q.label} ${year}` })
    }
  }

  async function exportSheet() {
    if (filteredRows.length === 0) { toast.error('Няма редове за експорт'); return }
    const headers = ['№', 'Фирма', 'Ритъм', ...MONTH_NAMES.map(m => m.slice(0, 3)), 'Общо', 'Тренд']
    const rowsOut: (string | number)[][] = filteredRows.map((r, i) => [
      i + 1, r.name, r.kind === 'month' ? 'месечно' : 'тримесечно',
      ...r.monthResults.map(v => v ?? ''),
      r.total || '',
      r.trend > 0 ? 'нагоре' : r.trend < 0 ? 'надолу' : '',
    ])
    try {
      await exportRowsToExcel({ headers, rows: rowsOut, sheetName: `Приключвания ${year}`, fileName: `CPlus360_Zakljuchvania_${year}.xlsx` })
      toast.success(`Експортирани ${rowsOut.length} реда`)
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при експорт')
    }
  }

  const modalExisting = modalFor
    ? closingsByClient.get(modalFor.clientId)?.get(`${modalFor.kind}:${modalFor.periodNo}`)
    : undefined

  return (
    <>
      {/* Filter strip */}
      <div className="px-3 md:px-5 py-2 border-b border-border bg-card flex flex-wrap items-center gap-3 text-xs">
        <span className="text-muted-foreground">
          Показват се само фирми с <strong className="text-foreground">Мониторинг = ДА</strong>
        </span>
        <div className="ml-auto flex items-center gap-4">
          <span><strong className="text-foreground">{filteredRows.length}</strong> {filteredRows.length === 1 ? 'фирма' : 'фирми'}</span>
          <span>Общо резултат: <strong className={`tabular-nums ${
            footer.grand > 0 ? 'text-emerald-700 dark:text-emerald-400' : footer.grand < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'
          }`}>{footer.grand > 0 ? '+' : ''}{fmt(footer.grand) || '0,00'} €</strong></span>
          <Button variant="outline" size="sm" onClick={() => void exportSheet()} title="Excel експорт">
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Експорт</span>
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-6 text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Зареждане...
          </div>
        ) : !monitorCol ? (
          <div className="p-10 text-center text-muted-foreground">
            Липсва колона „{MONITOR_COLUMN}" в Клиенти. Добави я (тип Да/Не) от Настройки, за да маркираш кои фирми се следят.
          </div>
        ) : (
          <table className="w-full border-collapse min-w-[1400px]">
            <thead className="bg-navy text-white sticky top-0 z-30">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap w-10">#</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap sticky left-0 bg-navy z-40">Фирма</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">Ритъм</th>
                {MONTH_NAMES.map(m => (
                  <th key={m} className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider whitespace-nowrap">{m.slice(0, 3)}</th>
                ))}
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider whitespace-nowrap" title="Резултат за годината">Общо</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap" title="Последен период спрямо предходния">Тренд</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={17} className="p-10 text-center text-muted-foreground">
                    Няма фирми с „Мониторинг = ДА"{search ? ' по това търсене' : ''}. Маркирай фирмите с кредит/овърдрафт в Клиенти (колона „{MONITOR_COLUMN}").
                  </td>
                </tr>
              )}
              {filteredRows.map((row, i) => {
                const evenBg = i % 2 === 0 ? 'bg-card' : 'bg-muted/20'
                return (
                  <tr key={row.clientId} className={`border-b border-border hover:bg-gold/5 transition-colors ${evenBg}`}>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground/70 text-right">{i + 1}</td>
                    <td className={`px-3 py-1.5 font-medium text-foreground whitespace-nowrap sticky left-0 z-20 ${evenBg}`}>
                      {row.name || <span className="text-muted-foreground/40 italic">(без име)</span>}
                    </td>
                    {/* Ритъм — месечно / тримесечно (М/Т) */}
                    <td className="px-2 py-1.5 text-center">
                      <div className="inline-flex items-center rounded border border-border overflow-hidden">
                        {(['month', 'quarter'] as const).map(k => (
                          <button key={k} disabled={!canEdit}
                            onClick={() => void toggleKind(row.clientId, k)}
                            title={k === 'month' ? 'Месечно приключване' : 'Тримесечно приключване'}
                            className={`px-1.5 py-0.5 text-[10px] font-semibold transition ${
                              row.kind === k ? 'bg-navy text-white dark:bg-primary dark:text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted/50'
                            }`}>
                            {k === 'month' ? 'М' : 'Т'}
                          </button>
                        ))}
                      </div>
                    </td>
                    {ALL_MONTHS.map((mo, mi) => {
                      // Тримесечните фирми имат активна клетка само в края на тримесечието.
                      const isActive = row.kind === 'month' || QUARTERS.some(q => q.endMonth === mo)
                      const v = row.monthResults[mi]
                      if (!isActive) {
                        return <td key={mo} className="px-1 py-0.5 bg-muted/10" />
                      }
                      return (
                        <td key={mo} className="px-1 py-0.5 text-right">
                          <button
                            onClick={() => openCell(row, mi)}
                            title={row.kind === 'month' ? `${MONTH_NAMES[mi]} ${year}` : `${QUARTERS.find(q => q.endMonth === mo)?.label} ${year}`}
                            className={`w-full rounded px-1 py-1 text-xs tabular-nums text-right hover:bg-sky-100 dark:hover:bg-sky-900/30 transition ${colorCls(v)}`}
                          >
                            {v == null ? '—' : (v > 0 ? '+' : '') + (fmt(v) || '0,00')}
                          </button>
                        </td>
                      )
                    })}
                    <td className={`px-3 py-1.5 text-right text-xs font-semibold tabular-nums whitespace-nowrap ${
                      row.total > 0 ? 'text-emerald-700 dark:text-emerald-400' : row.total < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'
                    }`}>
                      {row.total > 0 ? '+' : ''}{fmt(row.total)}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {row.trend > 0 ? <TrendingUp className="inline h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        : row.trend < 0 ? <TrendingDown className="inline h-4 w-4 text-rose-600 dark:text-rose-400" />
                        : <Minus className="inline h-3 w-3 text-muted-foreground/40" />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {filteredRows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold text-foreground">
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2 sticky left-0 bg-muted/30 z-20">Общо</td>
                  <td></td>
                  {footer.perMonth.map((v, i) => (
                    <td key={i} className={`px-2 py-2 text-right text-xs tabular-nums whitespace-nowrap ${
                      v > 0 ? 'text-emerald-700 dark:text-emerald-400' : v < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'
                    }`}>{fmt(v)}</td>
                  ))}
                  <td className={`px-3 py-2 text-right text-xs tabular-nums whitespace-nowrap ${
                    footer.grand > 0 ? 'text-emerald-700 dark:text-emerald-400' : footer.grand < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'
                  }`}>{fmt(footer.grand)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>

      {modalFor && (
        <FinancialClosingModal
          clientName={modalFor.name}
          periodLabel={modalFor.label}
          clientId={modalFor.clientId}
          year={year}
          periodKind={modalFor.kind}
          periodNo={modalFor.periodNo}
          existing={modalExisting}
          disabled={!canEdit}
          onClose={() => setModalFor(null)}
          onSaved={() => invalidateFinancialClosings()}
          createdBy={user?.id}
        />
      )}
    </>
  )
}
