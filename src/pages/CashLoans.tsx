import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Search, Loader2, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '../lib/auth'
import { useClients, useColumns, useCellValues, useDropdownOptions, useCashLoanEntries, useInvalidateCrm } from '../lib/queries'
import { CASH_LOAN_KIND_LABELS, type CashLoanEntry, type CashLoanKind } from '../lib/types'
import { buildCellIndex, clientDisplayName } from '../lib/tableIndices'
import { exportRowsToExcel } from '../lib/export'
import { MONTH_NAMES } from '../lib/utils'
import { useRealtime } from '../lib/useRealtime'
import { usePersistentState } from '../lib/usePersistentState'
import { CashLoanModal } from '../components/CashLoanModal'
import { ClosingsSection } from './FinancialClosings'

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

function fmt(v: number): string {
  if (v === 0) return ''
  return new Intl.NumberFormat('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}

type Section = 'cash' | 'loan' | 'closing'

// ============================================================
// Финансов мониторинг — три свързани изгледа:
//   Каса / Заеми  → годишно обобщение на месечните записи (движения)
//   Приключвания  → Приходи/Разходи → Резултат за кредитни фирми
// Обвивката държи година + търсене + табовете; тялото се сменя.
// ============================================================
export function CashLoansPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [section, setSection] = usePersistentState<Section>('fm-tab', 'cash')
  const [search, setSearch] = usePersistentState('fm-search', '')

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
      {/* Title bar */}
      <div className="px-3 py-2 md:px-5 md:py-3 flex flex-wrap gap-y-2 items-center justify-between border-b border-border bg-card">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base md:text-lg font-semibold text-foreground">💰 Финансов мониторинг</h1>
          <div className="flex items-center gap-1 ml-2">
            <Button variant="outline" size="sm" onClick={() => setYear(y => y - 1)}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="px-3 py-1 text-sm font-semibold text-foreground min-w-[64px] text-center">{year}</span>
            <Button variant="outline" size="sm" onClick={() => setYear(y => y + 1)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Табове Каса / Заеми / Приключвания — горе вдясно до търсенето. */}
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            {([['cash', 'Каса'], ['loan', 'Заеми'], ['closing', 'Приключвания']] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setSection(k)}
                className={`px-3 py-1 text-sm font-semibold transition ${
                  section === k
                    ? 'bg-navy text-white dark:bg-primary dark:text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
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

      {section === 'closing'
        ? <ClosingsSection year={year} search={search} />
        : <CashLoanSection kind={section} year={year} search={search} />}
    </div>
  )
}

// ============================================================
// Каса / Заеми — годишно обобщение на месечните записи от Работния лист.
// Стойността е ДВИЖЕНИЕ за месеца; „С натрупване" = сбор от началото на
// годината. Клик на клетка отваря същия модал като в Работния лист.
// ============================================================
function CashLoanSection({ kind, year, search }: { kind: CashLoanKind; year: number; search: string }) {
  const { user } = useAuth()
  const clientsQ = useClients()
  const columnsQ = useColumns()
  const cellsQ = useCellValues()
  const dropdownsQ = useDropdownOptions()
  const masterReady = !!clientsQ.data && !!columnsQ.data && !!cellsQ.data && !!dropdownsQ.data

  const entriesQ = useCashLoanEntries(year, ALL_MONTHS)
  const { invalidateCashLoan } = useInvalidateCrm()

  useRealtime({
    channel: 'cash-loans',
    tables: ['crm_cash_loan_entries'],
    onChange: () => invalidateCashLoan(),
  })

  const [cumulative, setCumulative] = usePersistentState('cl-cumulative', false)
  const [modalFor, setModalFor] = useState<{ clientId: string; name: string; month: number } | null>(null)

  const canEdit = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'employee'
  const loading = !masterReady || (entriesQ.isLoading && !entriesQ.data)

  const cellIdx = useMemo(() => buildCellIndex(cellsQ.data ?? []), [cellsQ.data])
  const columns = useMemo(() => columnsQ.data ?? [], [columnsQ.data])

  const byClient = useMemo(() => {
    const m = new Map<string, Map<number, CashLoanEntry[]>>()
    ;(entriesQ.data ?? []).forEach(e => {
      const months = m.get(e.client_id) ?? new Map<number, CashLoanEntry[]>()
      const arr = months.get(e.month) ?? []
      arr.push(e)
      months.set(e.month, arr)
      m.set(e.client_id, months)
    })
    return m
  }, [entriesQ.data])

  function monthSum(months: Map<number, CashLoanEntry[]> | undefined, month: number): number {
    if (!months) return 0
    return (months.get(month) ?? []).reduce((s, e) => s + (e.kind === kind ? e.amount : 0), 0)
  }

  type Row = { clientId: string; name: string; monthly: number[]; total: number }
  const tableRows: Row[] = useMemo(() => {
    const rows: Row[] = []
    byClient.forEach((months, clientId) => {
      const monthly = ALL_MONTHS.map(m => monthSum(months, m))
      const total = monthly.reduce((s, v) => s + v, 0)
      let hasAny = false
      months.forEach(arr => { if (arr.some(e => e.kind === kind)) hasAny = true })
      if (!hasAny) return
      rows.push({ clientId, name: clientDisplayName(clientId, columns, cellIdx), monthly, total })
    })
    return rows.sort((a, b) => a.name.localeCompare(b.name, 'bg'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byClient, kind, columns, cellIdx])

  const filteredRows = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return tableRows
    return tableRows.filter(r => r.name.toLowerCase().includes(s))
  }, [tableRows, search])

  function displayValue(row: Row, monthIdx: number): number {
    if (!cumulative) return row.monthly[monthIdx]
    return row.monthly.slice(0, monthIdx + 1).reduce((s, v) => s + v, 0)
  }

  const footerTotals = useMemo(() => {
    const perMonth = ALL_MONTHS.map((_, i) =>
      filteredRows.reduce((s, r) => s + (cumulative ? r.monthly.slice(0, i + 1).reduce((x, v) => x + v, 0) : r.monthly[i]), 0))
    const grand = filteredRows.reduce((s, r) => s + r.total, 0)
    return { perMonth, grand }
  }, [filteredRows, cumulative])

  async function exportSheet() {
    if (filteredRows.length === 0) { toast.error('Няма редове за експорт'); return }
    const kindLabel = CASH_LOAN_KIND_LABELS[kind]
    const headers = ['№', 'Фирма', ...MONTH_NAMES.map(m => m.slice(0, 3)), 'Общо']
    const rows: (string | number)[][] = filteredRows.map((r, i) => [
      i + 1,
      r.name,
      ...ALL_MONTHS.map((_, mi) => displayValue(r, mi) || ''),
      r.total || '',
    ])
    const suffix = kind === 'cash' ? '_Kasa' : '_Zaem'
    const fileName = `CPlus360_CashLoans_${year}${suffix}${cumulative ? '_cumulative' : ''}.xlsx`
    try {
      await exportRowsToExcel({ headers, rows, sheetName: `${kindLabel} ${year}`, fileName })
      toast.success(`Експортирани ${rows.length} реда`)
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при експорт')
    }
  }

  const modalEntries = modalFor
    ? (byClient.get(modalFor.clientId)?.get(modalFor.month) ?? [])
    : []

  return (
    <>
      {/* Filter strip */}
      <div className="px-3 md:px-5 py-2 border-b border-border bg-card flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          {([[false, 'Месечно'], [true, 'С натрупване']] as const).map(([v, label]) => (
            <button
              key={label}
              onClick={() => setCumulative(v)}
              title={v ? 'Сбор от началото на годината до месеца включително' : 'Движение за конкретния месец'}
              className={`px-2 py-0.5 rounded-full font-semibold transition ${
                cumulative === v
                  ? 'bg-amber-200 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100'
                  : 'bg-muted/40 text-muted-foreground hover:bg-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-4">
          <span><strong className="text-foreground">{filteredRows.length}</strong> {filteredRows.length === 1 ? 'фирма' : 'фирми'}</span>
          <span>Общо за годината: <strong className={`tabular-nums ${
            footerTotals.grand > 0 ? 'text-emerald-700 dark:text-emerald-400' : footerTotals.grand < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'
          }`}>{fmt(footerTotals.grand) || '0,00'} €</strong></span>
          <Button variant="outline" size="sm" onClick={() => void exportSheet()} title="Excel експорт на видимите редове">
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Експорт</span>
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-6 text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Зареждане...
          </div>
        ) : (
          <table className="w-full border-collapse min-w-[1300px]">
            <thead className="bg-navy text-white sticky top-0 z-30">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap w-10">#</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap sticky left-0 bg-navy z-40">Фирма</th>
                {MONTH_NAMES.map(m => (
                  <th key={m} className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider whitespace-nowrap">{m.slice(0, 3)}</th>
                ))}
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider whitespace-nowrap" title={cumulative ? 'Общо за годината' : 'Сбор на месечните движения'}>Общо</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={15} className="p-10 text-center text-muted-foreground">
                    Няма записи „{kind === 'cash' ? 'Каса' : 'Заем'}" за {year} г. — добавят се от Работния лист (клетката „Каса/Заем" до „Банка") или с клик върху клетка тук.
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
                    {ALL_MONTHS.map((m, mi) => {
                      const v = displayValue(row, mi)
                      const cls = v === 0
                        ? 'text-muted-foreground/50'
                        : v > 0 ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-rose-600 dark:text-rose-400 font-semibold'
                      return (
                        <td key={m} className="px-1 py-0.5 text-right">
                          <button
                            onClick={() => setModalFor({ clientId: row.clientId, name: row.name, month: m })}
                            title={`${MONTH_NAMES[mi]} ${year} — клик за записите`}
                            className={`w-full rounded px-1 py-1 text-xs tabular-nums text-right hover:bg-sky-100 dark:hover:bg-sky-900/30 transition ${cls}`}
                          >
                            {fmt(v) || '—'}
                          </button>
                        </td>
                      )
                    })}
                    <td className={`px-3 py-1.5 text-right text-xs font-semibold tabular-nums whitespace-nowrap ${
                      row.total > 0 ? 'text-emerald-700 dark:text-emerald-400' : row.total < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'
                    }`}>
                      {fmt(row.total)}
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
                  {footerTotals.perMonth.map((v, i) => (
                    <td key={i} className={`px-2 py-2 text-right text-xs tabular-nums whitespace-nowrap ${
                      v > 0 ? 'text-emerald-700 dark:text-emerald-400' : v < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'
                    }`}>{fmt(v)}</td>
                  ))}
                  <td className={`px-3 py-2 text-right text-xs tabular-nums whitespace-nowrap ${
                    footerTotals.grand > 0 ? 'text-emerald-700 dark:text-emerald-400' : footerTotals.grand < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'
                  }`}>{fmt(footerTotals.grand)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>

      {modalFor && (
        <CashLoanModal
          clientId={modalFor.clientId}
          clientName={modalFor.name}
          year={year}
          month={modalFor.month}
          entries={modalEntries}
          disabled={!canEdit}
          onClose={() => setModalFor(null)}
          onChanged={() => invalidateCashLoan()}
          createdBy={user?.id}
        />
      )}
    </>
  )
}
