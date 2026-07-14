import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, CheckCheck, Plus, Search, Trash2, Wallet, X, MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '../lib/auth'
import {
  useClients, useColumns, useCellValues, usePaymentConfigs, usePaymentStatuses, useInvalidateCrm,
} from '../lib/queries'
import {
  upsertPaymentConfig, deletePaymentConfig, setPaymentStatus, setPaymentStatusBulk,
} from '../lib/storage'
import { PAYMENT_TYPES, PAYMENT_TYPE_COLORS, BANKS, type PaymentConfig, type PaymentStatus } from '../lib/types'
import { queryClient } from '../lib/queryClient'

const MONTHS = [
  'Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни',
  'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември',
]
const MONTHS_SHORT = ['Ян', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек']

export function PaymentsPage() {
  const { user } = useAuth()
  const [year, setYear] = useState(new Date().getFullYear())
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string[]>([])
  const [showAddModal, setShowAddModal] = useState(false)

  const clientsQ = useClients()
  const columnsQ = useColumns()
  const cellsQ = useCellValues()
  const configsQ = usePaymentConfigs()
  const statusesQ = usePaymentStatuses(year)
  const { invalidatePaymentConfigs, invalidatePaymentStatuses } = useInvalidateCrm()

  const clients = useMemo(() => clientsQ.data ?? [], [clientsQ.data])
  const columns = useMemo(() => columnsQ.data ?? [], [columnsQ.data])
  const cells = useMemo(() => cellsQ.data ?? [], [cellsQ.data])
  const configs = useMemo(() => configsQ.data ?? [], [configsQ.data])
  const statuses = useMemo(() => statusesQ.data ?? [], [statusesQ.data])

  // Името на фирмата от първата text колона.
  const nameColId = useMemo(
    () => [...columns].sort((a, b) => a.position - b.position).find(c => c.type === 'text')?.id,
    [columns],
  )
  const nameByClient = useMemo(() => {
    const m = new Map<string, string>()
    if (!nameColId) return m
    cells.forEach(c => {
      if (c.column_id === nameColId && c.value_text) m.set(c.client_id, c.value_text)
    })
    return m
  }, [cells, nameColId])

  // Конфигурации по client_id и статус-индекс за бърз lookup.
  const configByClient = useMemo(() => {
    const m = new Map<string, PaymentConfig>()
    configs.forEach(c => m.set(c.client_id, c))
    return m
  }, [configs])
  const statusKey = (clientId: string, type: string, month: number) => `${clientId}|${type}|${month}`
  const statusIdx = useMemo(() => {
    const m = new Map<string, PaymentStatus>()
    statuses.forEach(s => m.set(statusKey(s.client_id, s.payment_type, s.month), s))
    return m
  }, [statuses])

  // ============================================================
  // Редовете на матрицата — (клиент × тип). Един проследен клиент с N
  // типа дава N последователни реда. Подреждаме клиентите по име.
  // ============================================================
  type PaymentRow = {
    clientId: string
    clientName: string
    config: PaymentConfig
    paymentType: string
    isFirstOfClient: boolean
    typeRowCount: number  // за rowspan на bank/notes
  }
  const rows = useMemo(() => {
    const out: PaymentRow[] = []
    const sorted = [...configs]
      .map(c => ({ config: c, name: nameByClient.get(c.client_id) ?? '—' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
    sorted.forEach(({ config, name }) => {
      // Подреждаме типовете по PAYMENT_TYPES за консистентност; чужди типове в края.
      const known: string[] = PAYMENT_TYPES.filter(t => config.payment_types.includes(t))
      const unknown: string[] = config.payment_types.filter(t => !PAYMENT_TYPES.includes(t as never))
      // Филтърът по тип се прилага ТУК (не върху готовите редове), за да са
      // верни isFirstOfClient/typeRowCount и rowspan-ът на Фирма/Банка/Забележка.
      const types: string[] = [...known, ...unknown]
        .filter(t => typeFilter.length === 0 || typeFilter.includes(t))
      types.forEach((type, idx) => {
        out.push({
          clientId: config.client_id,
          clientName: name,
          config,
          paymentType: type,
          isFirstOfClient: idx === 0,
          typeRowCount: types.length,
        })
      })
    })
    const q = search.trim().toLowerCase()
    return q ? out.filter(r => r.clientName.toLowerCase().includes(q)) : out
  }, [configs, nameByClient, search, typeFilter])

  const ready = !!clientsQ.data && !!columnsQ.data && !!cellsQ.data && !!configsQ.data && !!statusesQ.data

  // ============================================================
  // Toggle на checkbox в клетката — оптимистичен update (чекът реагира
  // веднага, без да чака мрежата) + revert с ясен toast при грешка.
  // ============================================================
  const applyStatusLocally = useCallback((clientId: string, type: string, month: number, paid: boolean) => {
    queryClient.setQueryData<PaymentStatus[]>(['paymentStatuses', year], (prev) => {
      if (!prev) return prev
      const idx = prev.findIndex(s => s.client_id === clientId && s.payment_type === type && s.month === month)
      if (idx >= 0) return prev.map((s, i) => i === idx ? { ...s, paid } : s)
      return [...prev, {
        id: `optimistic-${clientId}-${type}-${month}`,
        client_id: clientId, payment_type: type, year, month,
        paid, paid_at: paid ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(), updated_by: null,
      } as PaymentStatus]
    })
  }, [year])

  const togglePaid = useCallback(async (clientId: string, type: string, month: number, paid: boolean) => {
    applyStatusLocally(clientId, type, month, paid)
    try {
      await setPaymentStatus(clientId, type, year, month, paid, user?.id)
      await invalidatePaymentStatuses(year)
    } catch {
      // Revert + ясно съобщение — да не остане чек, който не е записан.
      applyStatusLocally(clientId, type, month, !paid)
      toast.error('Записът не мина (връзката) — отметката е върната. Опитай пак.')
    }
  }, [year, user?.id, invalidatePaymentStatuses, applyStatusLocally])

  const saveBank = useCallback(async (clientId: string, bank: string) => {
    try {
      await upsertPaymentConfig(clientId, { bank: bank || null }, user?.id)
      await invalidatePaymentConfigs()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
    }
  }, [user?.id, invalidatePaymentConfigs])

  const saveNotes = useCallback(async (clientId: string, notes: string) => {
    try {
      await upsertPaymentConfig(clientId, { notes: notes || null }, user?.id)
      await invalidatePaymentConfigs()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
    }
  }, [user?.id, invalidatePaymentConfigs])

  // ============================================================
  // Bulk операция на колона (месец): маркирай / изчисти даден месец за
  // всички видими редове. Един batch upsert вместо N отделни.
  // Действа само върху ВИДИМИТЕ редове — ако филтрираш по име, ще се
  // докоснат само те. Това е защита срещу „случайно маркирах всички".
  // ============================================================
  const bulkColumn = useCallback(async (month: number, paid: boolean) => {
    if (rows.length === 0) return
    const verb = paid ? 'маркираш' : 'изчистиш'
    const monthName = MONTHS[month - 1]
    if (!confirm(`Сигурен ли си, че искаш да ${verb} „${monthName}" за всички ${rows.length} видими реда?`)) return
    try {
      const payload = rows.map(r => ({
        clientId: r.clientId,
        paymentType: r.paymentType,
        year,
        month,
      }))
      await setPaymentStatusBulk(payload, paid, user?.id)
      await invalidatePaymentStatuses(year)
      toast.success(paid ? `„${monthName}" е маркиран за ${rows.length} реда` : `„${monthName}" е изчистен за ${rows.length} реда`)
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
    }
  }, [rows, year, user?.id, invalidatePaymentStatuses])

  const [openColumnMenu, setOpenColumnMenu] = useState<number | null>(null)

  const removeClient = useCallback(async (clientId: string, name: string) => {
    if (!confirm(`Да премахна „${name}" от проследяване на плащания?\n\nЩе се изтрият всички отметки за тази фирма (за всички години).`)) return
    try {
      await deletePaymentConfig(clientId)
      await invalidatePaymentConfigs()
      await invalidatePaymentStatuses(year)
      toast.success(`„${name}" е премахнат от плащания`)
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка')
    }
  }, [year, invalidatePaymentConfigs, invalidatePaymentStatuses])

  // ============================================================
  // Footer статистика — брой платени per месец/тип.
  // ============================================================
  const stats = useMemo(() => {
    // monthly[month] = брой платени; monthTotal[month] = общо клетки за месец
    const paidByMonth = Array(13).fill(0) as number[]
    const totalByMonth = Array(13).fill(0) as number[]
    rows.forEach(r => {
      for (let m = 1; m <= 12; m++) {
        totalByMonth[m]++
        if (statusIdx.get(statusKey(r.clientId, r.paymentType, m))?.paid) paidByMonth[m]++
      }
    })
    return { paidByMonth, totalByMonth }
  }, [rows, statusIdx])

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-full min-h-[50vh] text-muted-foreground">
        <div className="flex items-center gap-2 text-sm">
          <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Зареждане...
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] md:h-screen">
      {/* Header */}
      <div className="px-3 py-2 md:px-5 md:py-3 border-b border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <Wallet className="h-5 w-5 text-muted-foreground" />
            <div>
              <h1 className="text-base md:text-lg font-semibold text-foreground">Плащания</h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Месечни плащания на РЗ / осиг / ДДС, които правим за клиентите.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Year picker */}
            <div className="flex items-center gap-1 border border-border rounded-md bg-background">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setYear(y => y - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2 text-sm font-semibold">{year}</span>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setYear(y => y + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button size="sm" onClick={() => setShowAddModal(true)}>
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Добави клиент</span>
            </Button>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-3">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Търси фирма..."
              className="w-full md:w-72 pl-8 pr-3 py-1.5 text-xs border border-border rounded bg-background focus:border-primary focus:outline-none"
            />
          </div>
          {/* Филтър по тип плащане — multi-select; празен избор = всички */}
          <div className="flex items-center gap-1.5">
            {PAYMENT_TYPES.map(t => {
              const active = typeFilter.includes(t)
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeFilter(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}
                  title={active ? `Скрий филтъра „${t}"` : `Покажи само „${t}"`}
                  className={`px-2 py-1 text-[11px] border rounded font-medium transition-all ${
                    active
                      ? PAYMENT_TYPE_COLORS[t] + ' ring-1 ring-current/40'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted/30'
                  }`}
                >
                  {t}
                </button>
              )
            })}
            {typeFilter.length > 0 && (
              <button
                type="button"
                onClick={() => setTypeFilter([])}
                className="px-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
                title="Изчисти филтъра по тип"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            Проследени: <span className="font-semibold text-foreground">{configs.length}</span>
            <span className="mx-2">·</span>
            Редове: <span className="font-semibold text-foreground">{rows.length}</span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-20 bg-navy text-white">
            <tr>
              <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider min-w-[180px] sticky left-0 z-30 bg-navy border-r border-navy-light">Фирма</th>
              <th className="text-left px-2 py-2 font-semibold uppercase tracking-wider min-w-[60px] border-r border-navy-light">Тип</th>
              {MONTHS_SHORT.map((m, i) => {
                const monthNum = i + 1
                const isOpen = openColumnMenu === monthNum
                return (
                  <th key={i} className="relative text-center px-1 py-2 font-semibold min-w-[44px]" title={MONTHS[i]}>
                    <button
                      type="button"
                      onClick={() => setOpenColumnMenu(isOpen ? null : monthNum)}
                      className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded hover:bg-white/10 transition-colors"
                      title={`${MONTHS[i]} — bulk операции`}
                    >
                      <span>{m}</span>
                      <MoreVertical className="h-3 w-3 opacity-60" />
                    </button>
                    {isOpen && (
                      <>
                        {/* Click-outside overlay */}
                        <div className="fixed inset-0 z-30" onClick={() => setOpenColumnMenu(null)} />
                        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-40 min-w-[180px] bg-card text-foreground border border-border rounded-md shadow-lg overflow-hidden">
                          <button
                            type="button"
                            onClick={() => { setOpenColumnMenu(null); bulkColumn(monthNum, true) }}
                            className="w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
                          >
                            <CheckCheck className="h-3.5 w-3.5" />
                            Маркирай „{MONTHS[i]}" за всички
                          </button>
                          <button
                            type="button"
                            onClick={() => { setOpenColumnMenu(null); bulkColumn(monthNum, false) }}
                            className="w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 hover:bg-muted border-t border-border"
                          >
                            <X className="h-3.5 w-3.5" />
                            Изчисти „{MONTHS[i]}" за всички
                          </button>
                        </div>
                      </>
                    )}
                  </th>
                )
              })}
              <th className="text-left px-2 py-2 font-semibold uppercase tracking-wider min-w-[100px] border-l border-navy-light">Банка</th>
              <th className="text-left px-2 py-2 font-semibold uppercase tracking-wider min-w-[140px]">Забележка</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={17} className="text-center py-12 text-muted-foreground">
                  {search || typeFilter.length > 0 ? 'Няма намерени фирми.' : 'Няма проследени клиенти. Натисни „Добави клиент" за начало.'}
                </td>
              </tr>
            ) : rows.map(r => {
              const typeColor = PAYMENT_TYPE_COLORS[r.paymentType] ?? 'bg-muted text-foreground border-border'
              return (
                <tr key={`${r.clientId}-${r.paymentType}`} className="border-b border-border hover:bg-accent/30">
                  {r.isFirstOfClient ? (
                    <td rowSpan={r.typeRowCount} className="px-3 py-1.5 font-medium text-foreground sticky left-0 z-10 bg-background border-r border-border align-top">
                      {r.clientName}
                    </td>
                  ) : null}
                  <td className="px-2 py-1 border-r border-border">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium ${typeColor}`}>
                      {r.paymentType}
                    </span>
                  </td>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
                    const status = statusIdx.get(statusKey(r.clientId, r.paymentType, m))
                    const paid = !!status?.paid
                    return (
                      <td key={m} className="text-center px-1 py-1">
                        <input
                          type="checkbox"
                          checked={paid}
                          onChange={e => togglePaid(r.clientId, r.paymentType, m, e.target.checked)}
                          className="h-4 w-4 cursor-pointer accent-emerald-600"
                          title={paid && status?.paid_at ? `Платено: ${new Date(status.paid_at).toLocaleDateString('bg-BG')}` : MONTHS[m - 1]}
                        />
                      </td>
                    )
                  })}
                  {r.isFirstOfClient ? (
                    <>
                      <td rowSpan={r.typeRowCount} className="px-2 py-1 border-l border-border align-top">
                        <BankCell value={r.config.bank ?? ''} onSave={v => saveBank(r.clientId, v)} />
                      </td>
                      <td rowSpan={r.typeRowCount} className="px-2 py-1 align-top">
                        <NoteCell value={r.config.notes ?? ''} onSave={v => saveNotes(r.clientId, v)} />
                      </td>
                      <td rowSpan={r.typeRowCount} className="px-1 py-1 align-top">
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive/60 hover:text-destructive" onClick={() => removeClient(r.clientId, r.clientName)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </td>
                    </>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-muted/30 sticky bottom-0 z-10">
              <tr className="border-t-2 border-border font-semibold">
                <td className="px-3 py-2 sticky left-0 bg-muted/30 border-r border-border z-10" colSpan={2}>Σ платени</td>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
                  const paid = stats.paidByMonth[m]
                  const total = stats.totalByMonth[m]
                  const color = total === 0 ? 'text-muted-foreground'
                    : paid === total ? 'text-emerald-700 dark:text-emerald-400'
                    : paid > 0 ? 'text-amber-600' : 'text-muted-foreground'
                  return (
                    <td key={m} className={`text-center px-1 py-2 text-[11px] ${color}`}>
                      {total > 0 ? `${paid}/${total}` : '—'}
                    </td>
                  )
                })}
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {showAddModal && (
        <AddClientModal
          clients={clients}
          nameByClient={nameByClient}
          existingConfigs={configByClient}
          onClose={() => setShowAddModal(false)}
          onSave={async (clientId, types, bank, notes) => {
            await upsertPaymentConfig(clientId, { payment_types: types, bank: bank || null, notes: notes || null }, user?.id)
            await invalidatePaymentConfigs()
            setShowAddModal(false)
            toast.success('Клиентът е добавен в плащания')
          }}
        />
      )}
    </div>
  )
}

// ============================================================
// Inline cells
// ============================================================
// Банка — dropdown от списъка на БНБ. Запазва веднага при промяна.
// Допуска и стойности извън списъка (наследени), за да не „пропаднат" стари
// записи, ако някоя банка беше въведена ръчно преди.
function BankCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const isCustom = value && !BANKS.includes(value as typeof BANKS[number])
  return (
    <select
      value={value}
      onChange={e => onSave(e.target.value)}
      className="w-full h-7 px-1 text-xs border border-border rounded bg-background focus:border-primary focus:outline-none"
    >
      <option value="">—</option>
      {BANKS.map(b => (
        <option key={b} value={b}>{b}</option>
      ))}
      {isCustom && <option value={value}>{value} (стара)</option>}
    </select>
  )
}

function NoteCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return (
    <input
      type="text"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onSave(draft) }}
      placeholder="—"
      className="w-full h-7 px-2 text-xs border border-border rounded bg-background focus:border-primary focus:outline-none"
    />
  )
}

// ============================================================
// Modal: Добави клиент към проследяване
// ============================================================
function AddClientModal({
  clients, nameByClient, existingConfigs, onClose, onSave,
}: {
  clients: { id: string }[]
  nameByClient: Map<string, string>
  existingConfigs: Map<string, PaymentConfig>
  onClose: () => void
  onSave: (clientId: string, types: string[], bank: string, notes: string) => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [bank, setBank] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const availableClients = useMemo(() => {
    const q = search.trim().toLowerCase()
    return clients
      .map(c => ({ id: c.id, name: nameByClient.get(c.id) ?? '—' }))
      .filter(c => !existingConfigs.has(c.id))
      .filter(c => q ? c.name.toLowerCase().includes(q) : true)
      .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
      .slice(0, 50)
  }, [clients, nameByClient, existingConfigs, search])

  function toggleType(t: string) {
    setSelectedTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  const canSave = selectedClientId && selectedTypes.length > 0 && !saving

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-foreground">Добави клиент в плащания</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Client picker */}
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Фирма</label>
            {selectedClientId ? (
              <div className="flex items-center justify-between px-3 py-2 border border-border rounded-md bg-muted/30">
                <span className="text-sm font-medium">{nameByClient.get(selectedClientId)}</span>
                <Button variant="ghost" size="sm" onClick={() => setSelectedClientId(null)}>Смени</Button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Търси фирма..."
                  autoFocus
                  className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none"
                />
                <div className="mt-2 max-h-48 overflow-auto border border-border rounded-md">
                  {availableClients.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">Няма налични клиенти</p>
                  ) : availableClients.map(c => (
                    <button
                      key={c.id}
                      onClick={() => { setSelectedClientId(c.id); setSearch('') }}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent/50 border-b border-border last:border-0"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Payment types */}
          <div>
            <label className="text-xs font-medium text-foreground block mb-1.5">Типове плащане</label>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_TYPES.map(t => {
                const active = selectedTypes.includes(t)
                const color = PAYMENT_TYPE_COLORS[t]
                return (
                  <button
                    key={t}
                    onClick={() => toggleType(t)}
                    className={`px-3 py-1 text-xs border rounded font-medium transition-all ${
                      active ? color + ' ring-2 ring-offset-1 ring-current/30' : 'border-border bg-background text-muted-foreground hover:bg-muted/30'
                    }`}
                  >
                    {t}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Bank */}
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Банка</label>
            <select
              value={bank}
              onChange={e => setBank(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none"
            >
              <option value="">— избери банка —</option>
              {BANKS.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Забележка</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="незадължително"
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <Button variant="ghost" onClick={onClose}>Отказ</Button>
          <Button
            disabled={!canSave}
            onClick={async () => {
              if (!selectedClientId) return
              setSaving(true)
              try {
                await onSave(selectedClientId, selectedTypes, bank, notes)
              } finally {
                setSaving(false)
              }
            }}
          >
            {saving ? 'Записване...' : 'Добави'}
          </Button>
        </div>
      </div>
    </div>
  )
}
