import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Search, Loader2, Download, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '../lib/auth'
import {
  useClients, useColumns, useCellValues, useDropdownOptions,
  useCashRegisters, useCashTurnover, useCashFirmMonthly, useInvalidateCrm,
} from '../lib/queries'
import {
  addCashRegister, updateCashRegister, deleteCashRegister,
  upsertCashTurnover, upsertCashFirmMonthly,
} from '../lib/storage'
import type { CashRegister, CashRegisterTurnover, CashFirmMonthly } from '../lib/types'
import { buildCellIndex, buildDropdownIndex, clientDisplayName, resolveDropdownText } from '../lib/tableIndices'
import { exportRowsToExcel } from '../lib/export'
import { MONTH_NAMES } from '../lib/utils'
import { useRealtime } from '../lib/useRealtime'
import { usePersistentState } from '../lib/usePersistentState'

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const MONITOR_COL = 'Касов апарат'

function fmt(v: number): string {
  if (v === 0) return ''
  return new Intl.NumberFormat('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}
function parseNum(raw: string): number {
  const v = parseFloat(raw.replace(',', '.'))
  return isNaN(v) ? 0 : v
}

// Редактируема числова клетка (запис на blur/Enter).
function NumCell({ value, disabled, onSave }: { value: number; disabled?: boolean; onSave: (v: number) => void }) {
  const [draft, setDraft] = useState(value ? String(value) : '')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { setDraft(value ? String(value) : '') }, [value])
  function commit() {
    const n = parseNum(draft)
    if (n === value) return
    onSave(n)
  }
  return (
    <input ref={ref} disabled={disabled} value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') ref.current?.blur(); if (e.key === 'Escape') { setDraft(value ? String(value) : ''); ref.current?.blur() } }}
      placeholder="—"
      className="h-7 w-full min-w-[70px] px-1 text-xs text-right border border-transparent hover:border-border focus:border-primary rounded bg-transparent tabular-nums"
    />
  )
}

// Само за четене клетка (смятащите се редове), с цвят.
function CalcCell({ v, strong }: { v: number; strong?: boolean }) {
  return (
    <td className={`px-1 py-1 text-right text-xs tabular-nums whitespace-nowrap ${strong ? 'font-bold' : 'font-semibold'} ${
      v > 0 ? 'text-emerald-700 dark:text-emerald-400' : v < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'
    }`}>{fmt(v)}</td>
  )
}

// ============================================================
// Касови апарати / СПО — за фирми с „Касов апарат" = ДА.
// По фирма: апаратите × 12 месеца (оборот/сторно 20%/9%) + фактури в
// брой + РЗОК; Общо/Чист оборот/СПО се смятат. Обобщение: СПО по фирма.
// СПО 20% = (Общо20 − Сторно20) − Фактури20 − РЗОК; СПО 9% = (Общо9 − Сторно9) − Фактури9.
// ============================================================
export function CashRegistersPage() {
  const { user } = useAuth()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [view, setView] = usePersistentState<'firm' | 'summary'>('spo-view', 'firm')
  const [search, setSearch] = usePersistentState('spo-search', '')
  const [selectedClient, setSelectedClient] = usePersistentState<string>('spo-client', '')

  const clientsQ = useClients()
  const columnsQ = useColumns()
  const cellsQ = useCellValues()
  const dropdownsQ = useDropdownOptions()
  const registersQ = useCashRegisters()
  const turnoverQ = useCashTurnover(year)
  const firmMonthlyQ = useCashFirmMonthly(year)
  const { invalidateCashRegisters, invalidateCashTurnover, invalidateCashFirmMonthly } = useInvalidateCrm()

  useRealtime({
    channel: 'cash-registers',
    tables: ['crm_cash_registers', 'crm_cash_register_turnover', 'crm_cash_firm_monthly'],
    onChange: () => { invalidateCashRegisters(); invalidateCashTurnover(); invalidateCashFirmMonthly() },
  })

  const canEdit = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'employee'
  const masterReady = !!clientsQ.data && !!columnsQ.data && !!cellsQ.data && !!dropdownsQ.data
  const loading = !masterReady || (registersQ.isLoading && !registersQ.data)

  const columns = useMemo(() => columnsQ.data ?? [], [columnsQ.data])
  const cellIdx = useMemo(() => buildCellIndex(cellsQ.data ?? []), [cellsQ.data])
  const dropdownIdx = useMemo(() => buildDropdownIndex(dropdownsQ.data ?? []), [dropdownsQ.data])
  const monitorCol = useMemo(() => columns.find(c => c.name === MONITOR_COL), [columns])

  // Фирми с „Касов апарат" = ДА.
  const firms = useMemo(() => {
    if (!monitorCol) return [] as { id: string; name: string }[]
    return (clientsQ.data ?? [])
      .filter(c => resolveDropdownText(c.id, monitorCol, cellIdx, dropdownIdx).trim().toUpperCase() === 'ДА')
      .map(c => ({ id: c.id, name: clientDisplayName(c.id, columns, cellIdx) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  }, [clientsQ.data, monitorCol, cellIdx, dropdownIdx, columns])

  const filteredFirms = useMemo(() => {
    const s = search.trim().toLowerCase()
    return s ? firms.filter(f => f.name.toLowerCase().includes(s)) : firms
  }, [firms, search])

  // register_id → month → запис
  const turnoverByReg = useMemo(() => {
    const m = new Map<string, Map<number, CashRegisterTurnover>>()
    ;(turnoverQ.data ?? []).forEach(t => {
      const inner = m.get(t.register_id) ?? new Map<number, CashRegisterTurnover>()
      inner.set(t.month, t)
      m.set(t.register_id, inner)
    })
    return m
  }, [turnoverQ.data])
  // client_id → month → запис (фирмени)
  const firmByClient = useMemo(() => {
    const m = new Map<string, Map<number, CashFirmMonthly>>()
    ;(firmMonthlyQ.data ?? []).forEach(f => {
      const inner = m.get(f.client_id) ?? new Map<number, CashFirmMonthly>()
      inner.set(f.month, f)
      m.set(f.client_id, inner)
    })
    return m
  }, [firmMonthlyQ.data])
  const registersByClient = useMemo(() => {
    const m = new Map<string, CashRegister[]>()
    ;(registersQ.data ?? []).forEach(r => {
      const arr = m.get(r.client_id) ?? []
      arr.push(r)
      m.set(r.client_id, arr)
    })
    return m
  }, [registersQ.data])

  // Изчислените СПО стойности за (фирма × месец).
  function computeFirmMonth(clientId: string, month: number) {
    const regs = registersByClient.get(clientId) ?? []
    let total20 = 0, storno20 = 0, total9 = 0, storno9 = 0
    for (const r of regs) {
      const t = turnoverByReg.get(r.id)?.get(month)
      if (t) { total20 += t.turnover_20; storno20 += t.storno_20; total9 += t.turnover_9; storno9 += t.storno_9 }
    }
    const fm = firmByClient.get(clientId)?.get(month)
    const inv20 = fm?.invoices_cash_20 ?? 0, inv9 = fm?.invoices_cash_9 ?? 0, rzok = fm?.rzok ?? 0
    const ki20 = fm?.credit_note_20 ?? 0, ki9 = fm?.credit_note_9 ?? 0
    const net20 = total20 - storno20
    const net9 = total9 - storno9
    const chist = net20 + net9
    // КИ (кредитни известия) се ПРИБАВЯТ; фактурите в брой и РЗОК се изваждат.
    const spo20 = net20 - inv20 - rzok + ki20
    const spo9 = net9 - inv9 + ki9
    return { total20, storno20, total9, storno9, inv20, inv9, ki20, ki9, rzok, net20, net9, chist, spo20, spo9, spoTotal: spo20 + spo9, finalRow: chist - rzok }
  }

  // Ако избраната фирма изчезне от списъка — избираме първата.
  useEffect(() => {
    if (view !== 'firm') return
    if (!selectedClient || !firms.some(f => f.id === selectedClient)) {
      if (firms.length > 0) setSelectedClient(firms[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firms, view])

  const selectedRegs = selectedClient ? (registersByClient.get(selectedClient) ?? []) : []
  const selectedName = firms.find(f => f.id === selectedClient)?.name ?? ''

  async function saveTurnover(registerId: string, month: number, patch: Partial<CashRegisterTurnover>) {
    try { await upsertCashTurnover(registerId, year, month, patch); invalidateCashTurnover() }
    catch (e) { toast.error((e as Error).message ?? 'Грешка при запис') }
  }
  async function saveFirm(clientId: string, month: number, patch: Partial<CashFirmMonthly>) {
    try { await upsertCashFirmMonthly(clientId, year, month, patch); invalidateCashFirmMonthly() }
    catch (e) { toast.error((e as Error).message ?? 'Грешка при запис') }
  }
  async function addRegister() {
    if (!selectedClient) return
    try { await addCashRegister({ client_id: selectedClient, createdBy: user?.id }); invalidateCashRegisters() }
    catch (e) { toast.error((e as Error).message ?? 'Грешка') }
  }
  async function removeRegister(id: string) {
    if (!window.confirm('Изтриване на апарата и всичките му обороти?')) return
    try { await deleteCashRegister(id); invalidateCashRegisters(); invalidateCashTurnover() }
    catch (e) { toast.error((e as Error).message ?? 'Грешка') }
  }

  async function exportFirm() {
    if (!selectedClient) return
    const headers = ['Ред', ...MONTH_NAMES.map(m => m.slice(0, 3))]
    const rows: (string | number)[][] = []
    for (const r of selectedRegs) {
      const label = `${r.object_name ?? ''} (${r.memory_number ?? ''})`
      rows.push([`${label} — Оборот 20%`, ...MONTHS.map(m => turnoverByReg.get(r.id)?.get(m)?.turnover_20 || '')])
      rows.push([`${label} — Сторно 20%`, ...MONTHS.map(m => turnoverByReg.get(r.id)?.get(m)?.storno_20 || '')])
      rows.push([`${label} — Оборот 9%`, ...MONTHS.map(m => turnoverByReg.get(r.id)?.get(m)?.turnover_9 || '')])
      rows.push([`${label} — Сторно 9%`, ...MONTHS.map(m => turnoverByReg.get(r.id)?.get(m)?.storno_9 || '')])
    }
    const calc = (sel: (c: ReturnType<typeof computeFirmMonth>) => number) => MONTHS.map(m => sel(computeFirmMonth(selectedClient, m)) || '')
    rows.push(['Фактури в брой 20%', ...MONTHS.map(m => firmByClient.get(selectedClient)?.get(m)?.invoices_cash_20 || '')])
    rows.push(['Фактури в брой 9%', ...MONTHS.map(m => firmByClient.get(selectedClient)?.get(m)?.invoices_cash_9 || '')])
    rows.push(['КИ 20%', ...MONTHS.map(m => firmByClient.get(selectedClient)?.get(m)?.credit_note_20 || '')])
    rows.push(['КИ 9%', ...MONTHS.map(m => firmByClient.get(selectedClient)?.get(m)?.credit_note_9 || '')])
    rows.push(['Финансов отчет РЗОК', ...MONTHS.map(m => firmByClient.get(selectedClient)?.get(m)?.rzok || '')])
    rows.push(['Общо 20%', ...calc(c => c.total20)])
    rows.push(['Общо 9%', ...calc(c => c.total9)])
    rows.push(['Чист оборот', ...calc(c => c.chist)])
    rows.push(['СПО 20%', ...calc(c => c.spo20)])
    rows.push(['СПО 9%', ...calc(c => c.spo9)])
    rows.push(['СПО общо', ...calc(c => c.spoTotal)])
    try {
      await exportRowsToExcel({ headers, rows, sheetName: `СПО ${year}`, fileName: `CPlus360_SPO_${selectedName}_${year}.xlsx`.replace(/[^\wа-яА-Я._-]/g, '_') })
      toast.success('Експортирано')
    } catch (e) { toast.error((e as Error).message ?? 'Грешка при експорт') }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
      {/* Title bar */}
      <div className="px-3 py-2 md:px-5 md:py-3 flex flex-wrap gap-y-2 items-center justify-between border-b border-border bg-card">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base md:text-lg font-semibold text-foreground">🧾 Касови апарати (СПО)</h1>
          <div className="flex items-center gap-1 ml-2">
            <Button variant="outline" size="sm" onClick={() => setYear(y => y - 1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
            <span className="px-3 py-1 text-sm font-semibold text-foreground min-w-[64px] text-center">{year}</span>
            <Button variant="outline" size="sm" onClick={() => setYear(y => y + 1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            {([['firm', 'По фирма'], ['summary', 'Обобщение']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setView(k)}
                className={`px-3 py-1 text-sm font-semibold transition ${view === k ? 'bg-navy text-white dark:bg-primary dark:text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}>
                {label}
              </button>
            ))}
          </div>
          {view === 'firm' && selectedClient && (
            <Button variant="outline" size="sm" onClick={() => void exportFirm()} title="Excel експорт">
              <Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">Експорт</span>
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-6 text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Зареждане...</div>
      ) : !monitorCol ? (
        <div className="p-10 text-center text-muted-foreground">
          Липсва колона „{MONITOR_COL}" в Клиенти. Добави я (тип Да/Не) от Настройки, за да маркираш кои фирми имат касов апарат.
        </div>
      ) : view === 'summary' ? (
        <SummaryView firms={filteredFirms} search={search} setSearch={setSearch} year={year} compute={computeFirmMonth} />
      ) : (
        <div className="flex-1 min-h-0 flex">
          {/* Ляво: списък фирми */}
          <div className="w-64 shrink-0 flex flex-col border-r border-border min-h-0">
            <div className="px-2 py-2 border-b border-border bg-card">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Търси фирма..." className="h-8 pl-8 text-sm" />
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {filteredFirms.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">Няма фирми с „Касов апарат = ДА".</p>
              )}
              {filteredFirms.map(f => (
                <button key={f.id} onClick={() => setSelectedClient(f.id)}
                  className={`block w-full text-left px-3 py-2 text-sm border-b border-border transition ${f.id === selectedClient ? 'bg-sky-50 dark:bg-sky-900/20 font-semibold text-foreground' : 'hover:bg-muted/40 text-foreground'}`}>
                  {f.name}
                </button>
              ))}
            </div>
          </div>

          {/* Дясно: детайлна справка */}
          <div className="flex-1 overflow-auto">
            {!selectedClient ? (
              <p className="p-8 text-center text-muted-foreground">Избери фирма отляво.</p>
            ) : (
              <FirmDetail
                clientId={selectedClient} name={selectedName} year={year} registers={selectedRegs}
                turnoverByReg={turnoverByReg} firmByClient={firmByClient} compute={computeFirmMonth}
                canEdit={canEdit} onSaveTurnover={saveTurnover} onSaveFirm={saveFirm}
                onAddRegister={addRegister} onRemoveRegister={removeRegister}
                onUpdateRegister={async (id, patch) => { try { await updateCashRegister(id, patch); invalidateCashRegisters() } catch (e) { toast.error((e as Error).message ?? 'Грешка') } }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// -------- Детайлна справка на една фирма --------
function FirmDetail({ clientId, name, year, registers, turnoverByReg, firmByClient, compute, canEdit, onSaveTurnover, onSaveFirm, onAddRegister, onRemoveRegister, onUpdateRegister }: {
  clientId: string; name: string; year: number; registers: CashRegister[]
  turnoverByReg: Map<string, Map<number, CashRegisterTurnover>>
  firmByClient: Map<string, Map<number, CashFirmMonthly>>
  compute: (clientId: string, month: number) => ReturnType<any>
  canEdit: boolean
  onSaveTurnover: (registerId: string, month: number, patch: Partial<CashRegisterTurnover>) => void
  onSaveFirm: (clientId: string, month: number, patch: Partial<CashFirmMonthly>) => void
  onAddRegister: () => void
  onRemoveRegister: (id: string) => void
  onUpdateRegister: (id: string, patch: { object_name?: string | null; memory_number?: string | null }) => void
}) {
  const calc = MONTHS.map(m => compute(clientId, m))
  const th = 'px-2 py-2 text-right text-xs font-medium uppercase tracking-wider whitespace-nowrap'
  return (
    <div className="p-3">
      <table className="w-full border-collapse min-w-[1100px]">
        <thead className="bg-navy text-white sticky top-0 z-20">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap sticky left-0 bg-navy z-30 min-w-[240px]">Ред</th>
            {MONTH_NAMES.map(m => <th key={m} className={th}>{m.slice(0, 3)}</th>)}
          </tr>
        </thead>
        <tbody>
          {registers.map((r, ri) => (
            <RegisterRows key={r.id} reg={r} index={ri + 1} year={year} turnoverByReg={turnoverByReg}
              canEdit={canEdit} onSaveTurnover={onSaveTurnover} onRemove={() => onRemoveRegister(r.id)} onUpdate={onUpdateRegister} />
          ))}
          {canEdit && (
            <tr>
              <td colSpan={13} className="px-3 py-2 sticky left-0 bg-card">
                <Button variant="outline" size="sm" onClick={onAddRegister}><Plus className="h-3.5 w-3.5 mr-1" /> Добави апарат</Button>
              </td>
            </tr>
          )}

          {/* Фирмени редове */}
          <FirmRow label="Фактури в брой 20%" clientId={clientId} field="invoices_cash_20" firmByClient={firmByClient} canEdit={canEdit} onSave={onSaveFirm} />
          <FirmRow label="Фактури в брой 9%" clientId={clientId} field="invoices_cash_9" firmByClient={firmByClient} canEdit={canEdit} onSave={onSaveFirm} />
          <FirmRow label="КИ 20%" clientId={clientId} field="credit_note_20" firmByClient={firmByClient} canEdit={canEdit} onSave={onSaveFirm} />
          <FirmRow label="КИ 9%" clientId={clientId} field="credit_note_9" firmByClient={firmByClient} canEdit={canEdit} onSave={onSaveFirm} />
          <FirmRow label="Финансов отчет РЗОК" clientId={clientId} field="rzok" firmByClient={firmByClient} canEdit={canEdit} onSave={onSaveFirm} />

          {/* Смятащи се редове */}
          <CalcRow label="Общо 20%" calc={calc} sel={c => c.total20} />
          <CalcRow label="Общо 9%" calc={calc} sel={c => c.total9} />
          <CalcRow label="Чист оборот" calc={calc} sel={c => c.chist} />
          <CalcRow label="СПО 20%" calc={calc} sel={c => c.spo20} />
          <CalcRow label="СПО 9%" calc={calc} sel={c => c.spo9} />
          <CalcRow label="СПО общо" calc={calc} sel={c => c.spoTotal} strong />
        </tbody>
      </table>
      <p className="text-[11px] text-muted-foreground mt-2">
        {name} • СПО 20% = (Общо20 − Сторно20) − Фактури 20% − РЗОК + КИ 20% · СПО 9% = (Общо9 − Сторно9) − Фактури 9% + КИ 9%
      </p>
    </div>
  )
}

function RegisterRows({ reg, index, year, turnoverByReg, canEdit, onSaveTurnover, onRemove, onUpdate }: {
  reg: CashRegister; index: number; year: number
  turnoverByReg: Map<string, Map<number, CashRegisterTurnover>>
  canEdit: boolean
  onSaveTurnover: (registerId: string, month: number, patch: Partial<CashRegisterTurnover>) => void
  onRemove: () => void
  onUpdate: (id: string, patch: { object_name?: string | null; memory_number?: string | null }) => void
}) {
  const rows: Array<{ label: string; field: keyof Pick<CashRegisterTurnover, 'turnover_20' | 'storno_20' | 'turnover_9' | 'storno_9'> }> = [
    { label: 'Оборот 20%', field: 'turnover_20' },
    { label: 'Сторно 20%', field: 'storno_20' },
    { label: 'Оборот 9%', field: 'turnover_9' },
    { label: 'Сторно 9%', field: 'storno_9' },
  ]
  return (
    <>
      <tr className="bg-muted/40 border-t border-border">
        <td className="px-2 py-1.5 sticky left-0 bg-muted/40 z-10" colSpan={1}>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">{index}.</span>
            <input defaultValue={reg.object_name ?? ''} disabled={!canEdit} placeholder="Обект"
              onBlur={e => { if (e.target.value !== (reg.object_name ?? '')) onUpdate(reg.id, { object_name: e.target.value || null }) }}
              className="h-7 px-1 text-xs font-semibold border border-transparent hover:border-border focus:border-primary rounded bg-transparent w-36" />
            <input defaultValue={reg.memory_number ?? ''} disabled={!canEdit} placeholder="Памет"
              onBlur={e => { if (e.target.value !== (reg.memory_number ?? '')) onUpdate(reg.id, { memory_number: e.target.value || null }) }}
              className="h-7 px-1 text-xs font-mono border border-transparent hover:border-border focus:border-primary rounded bg-transparent w-28" />
            {canEdit && (
              <button onClick={onRemove} className="text-muted-foreground hover:text-destructive p-0.5" title="Изтрий апарата"><Trash2 className="h-3.5 w-3.5" /></button>
            )}
          </div>
        </td>
        {MONTHS.map(m => <td key={m} className="bg-muted/40" />)}
      </tr>
      {rows.map(row => (
        <tr key={row.field} className="border-b border-border/40">
          <td className="px-2 py-0.5 text-xs text-muted-foreground sticky left-0 bg-card z-10 pl-6">{row.label}</td>
          {MONTHS.map(m => {
            const t = turnoverByReg.get(reg.id)?.get(m)
            return (
              <td key={m} className="px-0.5 py-0.5">
                <NumCell value={t?.[row.field] ?? 0} disabled={!canEdit} onSave={v => onSaveTurnover(reg.id, m, { [row.field]: v })} />
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}

function FirmRow({ label, clientId, field, firmByClient, canEdit, onSave }: {
  label: string; clientId: string; field: keyof Pick<CashFirmMonthly, 'invoices_cash_20' | 'invoices_cash_9' | 'credit_note_20' | 'credit_note_9' | 'rzok'>
  firmByClient: Map<string, Map<number, CashFirmMonthly>>
  canEdit: boolean
  onSave: (clientId: string, month: number, patch: Partial<CashFirmMonthly>) => void
}) {
  return (
    <tr className="border-b border-border/40 bg-amber-50/40 dark:bg-amber-900/10">
      <td className="px-2 py-0.5 text-xs text-foreground font-medium sticky left-0 bg-amber-50/40 dark:bg-amber-900/10 z-10">{label}</td>
      {MONTHS.map(m => {
        const f = firmByClient.get(clientId)?.get(m)
        return (
          <td key={m} className="px-0.5 py-0.5">
            <NumCell value={f?.[field] ?? 0} disabled={!canEdit} onSave={v => onSave(clientId, m, { [field]: v })} />
          </td>
        )
      })}
    </tr>
  )
}

function CalcRow({ label, calc, sel, strong }: { label: string; calc: ReturnType<any>[]; sel: (c: any) => number; strong?: boolean }) {
  return (
    <tr className={`border-b border-border ${strong ? 'bg-navy/5 dark:bg-primary/10' : ''}`}>
      <td className={`px-2 py-1.5 text-xs sticky left-0 z-10 ${strong ? 'font-bold bg-navy/5 dark:bg-primary/10' : 'font-semibold bg-card'} text-foreground`}>{label}</td>
      {calc.map((c, i) => <CalcCell key={i} v={sel(c)} strong={strong} />)}
    </tr>
  )
}

// -------- Обобщение: СПО общо по фирма × месец --------
function SummaryView({ firms, search, setSearch, year, compute }: {
  firms: { id: string; name: string }[]; search: string; setSearch: (v: string) => void; year: number
  compute: (clientId: string, month: number) => ReturnType<any>
}) {
  const rows = firms.map(f => ({
    ...f,
    monthly: MONTHS.map(m => compute(f.id, m).spoTotal as number),
  }))
  const perMonth = MONTHS.map((_, i) => rows.reduce((s, r) => s + r.monthly[i], 0))
  const grand = rows.reduce((s, r) => s + r.monthly.reduce((x, v) => x + v, 0), 0)
  return (
    <>
      <div className="px-3 md:px-5 py-2 border-b border-border bg-card flex items-center gap-3 text-xs">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Търси фирма..." className="h-8 pl-8 w-44 text-sm" />
        </div>
        <span className="ml-auto">СПО общо {year}: <strong className="text-emerald-700 dark:text-emerald-400 tabular-nums">{fmt(grand) || '0,00'}</strong></span>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse min-w-[1100px]">
          <thead className="bg-navy text-white sticky top-0 z-20">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap sticky left-0 bg-navy z-30">Фирма</th>
              {MONTH_NAMES.map(m => <th key={m} className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider whitespace-nowrap">{m.slice(0, 3)}</th>)}
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider whitespace-nowrap">Общо</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={14} className="p-10 text-center text-muted-foreground">Няма фирми.</td></tr>
            )}
            {rows.map((r, i) => {
              const total = r.monthly.reduce((s, v) => s + v, 0)
              return (
                <tr key={r.id} className={`border-b border-border ${i % 2 === 0 ? 'bg-card' : 'bg-muted/20'}`}>
                  <td className={`px-3 py-1.5 font-medium text-foreground whitespace-nowrap sticky left-0 z-10 ${i % 2 === 0 ? 'bg-card' : 'bg-muted/20'}`}>{r.name}</td>
                  {r.monthly.map((v, mi) => <CalcCell key={mi} v={v} />)}
                  <td className="px-3 py-1.5 text-right text-xs font-bold tabular-nums text-foreground whitespace-nowrap">{fmt(total)}</td>
                </tr>
              )
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/30 font-semibold text-foreground">
                <td className="px-3 py-2 sticky left-0 bg-muted/30 z-10">Общо</td>
                {perMonth.map((v, i) => <CalcCell key={i} v={v} strong />)}
                <td className="px-3 py-2 text-right text-xs font-bold tabular-nums whitespace-nowrap">{fmt(grand)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  )
}
