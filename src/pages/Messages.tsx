import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Search, Loader2, Send, RefreshCw, Wallet, Plus, X, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '../lib/auth'
import {
  sendMobicaMessages, fetchMobicaDlr, fetchMobicaBalance,
  addClientMessages, updateClientMessageStatus,
  addMessageTemplate, updateMessageTemplate, deleteMessageTemplate,
} from '../lib/storage'
import {
  useClients, useColumns, useCellValues, useDropdownOptions, useAllContacts,
  useMonthlyWork, useClientMessages, useMessageTemplates, useInvalidateCrm,
} from '../lib/queries'
import { MESSAGE_STATUS_LABELS, type ClientMessage, type MessageStatus, type MessageTemplate } from '../lib/types'
import { buildCellIndex, buildDropdownIndex, clientDisplayName, resolveDropdownText, cellKey } from '../lib/tableIndices'
import { statusBadgeClass, isNoActivityStatus } from '../lib/statusBadge'
import { MONTH_NAMES, previousMonth, formatDateTime } from '../lib/utils'
import { useRealtime } from '../lib/useRealtime'
import { usePersistentState } from '../lib/usePersistentState'

// ============================================================
// Съобщения към клиенти — Mobica (Viber + автоматичен SMS fallback).
// Изпращат: admin + manager; служителите виждат само историята.
// Телефоните идват от Контакти (owner_phone). Шаблони с placeholder-и:
//   {фирма} {месец} {сума} {срок}
// „Месец" и „сума" са за РАБОТНИЯ месец (предходния календарен);
// срокът за ДДС е 14-о число на месеца след работния (конвенцията).
// ============================================================

/** 0888123456 / +359888123456 / 359 888 123 456 → 359888123456 (или null) */
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('0') && d.length === 10) d = '359' + d.slice(1)
  return /^359\d{8,9}$/.test(d) ? d : null
}

function fmtAmount(v: number): string {
  return new Intl.NumberFormat('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}

const STATUS_BADGE_CLS: Record<MessageStatus, string> = {
  accepted: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
  delivered: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  undelivered: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200',
  rejected: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200',
  unknown: 'bg-muted text-muted-foreground',
  error: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200',
}

// DLR кодове (Table 9): 1000 доставено; 1204 изтекло; 1205 недоставено;
// 1206 неизвестно; 1207 отхвърлено.
function dlrToStatus(code: number): MessageStatus {
  if (code === 1000) return 'delivered'
  if (code === 1205 || code === 1204) return 'undelivered'
  if (code === 1207) return 'rejected'
  return 'unknown'
}

export function MessagesPage() {
  const { user } = useAuth()
  const canSend = user?.role === 'admin' || user?.role === 'manager'
  const isAdmin = user?.role === 'admin'

  const [view, setView] = usePersistentState<'compose' | 'history'>('msg-view', canSend ? 'compose' : 'history')

  // Master данни (споделен кеш) + контакти за телефоните.
  const clientsQ = useClients()
  const columnsQ = useColumns()
  const cellsQ = useCellValues()
  const dropdownsQ = useDropdownOptions()
  const contactsQ = useAllContacts()
  const masterReady = !!clientsQ.data && !!columnsQ.data && !!cellsQ.data && !!dropdownsQ.data && !!contactsQ.data

  // Работен месец — за {месец}, {сума}, {срок}.
  const work = useMemo(() => previousMonth(), [])
  const monthlyWorkQ = useMonthlyWork(work.year, work.month)

  const messagesQ = useClientMessages()
  const templatesQ = useMessageTemplates()
  const { invalidateClientMessages, invalidateMessageTemplates } = useInvalidateCrm()

  useRealtime({
    channel: 'client-messages',
    tables: ['crm_client_messages'],
    onChange: () => invalidateClientMessages(),
  })

  const columns = useMemo(() => columnsQ.data ?? [], [columnsQ.data])
  const cellIdx = useMemo(() => buildCellIndex(cellsQ.data ?? []), [cellsQ.data])
  const dropdownIdx = useMemo(() => buildDropdownIndex(dropdownsQ.data ?? []), [dropdownsQ.data])
  const statusCol = useMemo(() => columns.find(c => c.name === 'Статус'), [columns])
  const accountantCol = useMemo(() => columns.find(c => c.name === 'Счетоводител'), [columns])

  // client_id → телефон (първият валиден owner_phone от Контакти).
  const phoneByClient = useMemo(() => {
    const m = new Map<string, string>()
    ;(contactsQ.data ?? []).forEach(c => {
      if (m.has(c.client_id)) return
      const p = normalizePhone(c.owner_phone)
      if (p) m.set(c.client_id, p)
    })
    return m
  }, [contactsQ.data])

  // client_id → Резултат € за работния месец ({сума}).
  const amountByClient = useMemo(() => {
    const m = new Map<string, number>()
    ;(monthlyWorkQ.data ?? []).forEach(w => {
      if (w.result_amount != null) m.set(w.client_id, w.result_amount)
    })
    return m
  }, [monthlyWorkQ.data])

  function accountantOf(clientId: string): string {
    if (!accountantCol) return ''
    const cell = cellIdx.get(cellKey(clientId, accountantCol.id))
    if (!cell) return ''
    if (cell.value_text) return cell.value_text
    if (cell.value_dropdown) return dropdownIdx.get(cell.value_dropdown)?.value ?? ''
    return ''
  }

  type Row = { clientId: string; name: string; status: string; accountant: string; phone: string | null; amount: number | null }
  const tableRows: Row[] = useMemo(() => {
    return (clientsQ.data ?? [])
      .map(c => ({
        clientId: c.id,
        name: clientDisplayName(c.id, columns, cellIdx),
        status: resolveDropdownText(c.id, statusCol, cellIdx, dropdownIdx),
        accountant: accountantOf(c.id),
        phone: phoneByClient.get(c.id) ?? null,
        amount: amountByClient.get(c.id) ?? null,
      }))
      .filter(r => !isNoActivityStatus(r.status))
      .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientsQ.data, columns, cellIdx, dropdownIdx, statusCol, accountantCol, phoneByClient, amountByClient])

  // ---------- Compose state ----------
  const [search, setSearch] = usePersistentState('msg-search', '')
  const [statusFilter, setStatusFilter] = usePersistentState<string[]>('msg-status', [])
  const [accountantFilter, setAccountantFilter] = usePersistentState<string>('msg-accountant', '')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [body, setBody] = usePersistentState('msg-body', '')
  const [sending, setSending] = useState(false)
  const [checkingDlr, setCheckingDlr] = useState(false)
  const [balance, setBalance] = useState<string | null>(null)
  const [templatesOpen, setTemplatesOpen] = useState(false)

  const statusOptions = useMemo(() => {
    if (!statusCol) return [] as string[]
    return [...new Set((dropdownsQ.data ?? []).filter(d => d.column_id === statusCol.id).map(d => d.value))]
      .filter(v => !isNoActivityStatus(v))
  }, [dropdownsQ.data, statusCol])
  const accountantOptions = useMemo(() =>
    [...new Set(tableRows.map(r => r.accountant).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'bg')),
  [tableRows])

  const filteredRows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return tableRows.filter(r => {
      if (statusFilter.length > 0 && !statusFilter.includes(r.status)) return false
      if (accountantFilter && r.accountant !== accountantFilter) return false
      if (s && !r.name.toLowerCase().includes(s)) return false
      return true
    })
  }, [tableRows, search, statusFilter, accountantFilter])

  const workMonthLabel = `${MONTH_NAMES[work.month - 1]} ${work.year}`
  const deadline = useMemo(() => {
    // ДДС срок: 14-о число на месеца СЛЕД работния.
    const m = work.month === 12 ? 1 : work.month + 1
    const y = work.month === 12 ? work.year + 1 : work.year
    return `14.${String(m).padStart(2, '0')}.${y}`
  }, [work])

  function resolveText(template: string, r: Row): string {
    return template
      .split('{фирма}').join(r.name)
      .split('{месец}').join(workMonthLabel)
      .split('{сума}').join(r.amount != null ? `${fmtAmount(r.amount)} €` : '{сума}')
      .split('{срок}').join(deadline)
  }

  const selectedRows = useMemo(() => filteredRows.filter(r => selected.has(r.clientId)), [filteredRows, selected])
  // Съобщение не тръгва с неразрешен placeholder ({сума} без Резултат).
  const readyRows = useMemo(() => selectedRows.filter(r => r.phone && !resolveText(body, r).includes('{сума}')), [selectedRows, body, workMonthLabel, deadline]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleAllVisible() {
    setSelected(prev => {
      const selectable = filteredRows.filter(r => r.phone)
      const allIn = selectable.every(r => prev.has(r.clientId)) && selectable.length > 0
      const next = new Set(prev)
      if (allIn) selectable.forEach(r => next.delete(r.clientId))
      else selectable.forEach(r => next.add(r.clientId))
      return next
    })
  }

  async function doSend() {
    if (!canSend || sending) return
    if (readyRows.length === 0) { toast.error('Няма готови съобщения за изпращане'); return }
    if (!body.trim()) { toast.error('Напиши текст на съобщението'); return }
    const skipped = selectedRows.length - readyRows.length
    const ok = window.confirm(
      `Ще изпратиш ${readyRows.length} съобщения (Viber + SMS fallback).` +
      (skipped > 0 ? `\n${skipped} избрани ще бъдат пропуснати (липсва телефон или сума).` : '') +
      `\n\nВсяко съобщение се таксува от Mobica акаунта. Продължи?`,
    )
    if (!ok) return

    setSending(true)
    try {
      const stamp = Date.now()
      const payload = readyRows.map((r, i) => ({
        idd: `cp360-${stamp}-${i}`,
        phone: r.phone!,
        text: resolveText(body, r),
        tag: `cplus360-${work.year}-${String(work.month).padStart(2, '0')}`,
        row: r,
      }))
      // Партиди по 100 (лимитът на edge функцията).
      for (let i = 0; i < payload.length; i += 100) {
        const batch = payload.slice(i, i + 100)
        let status: MessageStatus = 'accepted'
        let statusDesc: string | null = null
        try {
          const resp = await sendMobicaMessages(batch.map(({ row: _r, ...m }) => m))
          statusDesc = resp.description
        } catch (e) {
          status = 'error'
          statusDesc = (e as Error).message
        }
        await addClientMessages(batch.map(m => ({
          client_id: m.row.clientId,
          client_name: m.row.name,
          phone: m.phone,
          text: m.text,
          sms_text: m.text,
          idd: m.idd,
          tag: m.tag,
          status,
          status_desc: statusDesc,
          createdBy: user?.id,
        })))
        if (status === 'error') throw new Error(statusDesc ?? 'Грешка при изпращане')
      }
      toast.success(`Изпратени ${payload.length} съобщения`)
      setSelected(new Set())
      setView('history')
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при изпращане')
    } finally {
      invalidateClientMessages()
      setSending(false)
    }
  }

  // DLR: обновяваме статусите на съобщенията от последните 24ч без финален статус.
  async function checkDlr() {
    if (checkingDlr) return
    const cutoff = Date.now() - 24 * 60 * 60_000
    const pending = (messagesQ.data ?? []).filter(m =>
      (m.status === 'accepted' || m.status === 'unknown') && new Date(m.created_at).getTime() >= cutoff,
    )
    if (pending.length === 0) { toast.info('Няма съобщения за проверка (последните 24 часа)'); return }
    setCheckingDlr(true)
    try {
      for (let i = 0; i < pending.length; i += 200) {
        const batch = pending.slice(i, i + 200)
        const dlr = await fetchMobicaDlr(batch.map(m => m.idd))
        for (const m of batch) {
          const records = dlr[m.idd]
          if (!records || records.length === 0) continue
          // Последният запис е финалният (fallback SMS идва след Viber опита).
          const last = records[records.length - 1]
          await updateClientMessageStatus(m.idd, {
            status: dlrToStatus(last.code),
            status_code: String(last.code),
            status_desc: last.description,
            delivered_channel: last.channel,
            date_report: last.date_report ? new Date(last.date_report.replace(' ', 'T')).toISOString() : null,
          })
        }
      }
      toast.success('Статусите са обновени')
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при проверка на статусите')
    } finally {
      invalidateClientMessages()
      setCheckingDlr(false)
    }
  }

  async function loadBalance() {
    try {
      const b = await fetchMobicaBalance()
      setBalance(`${b.amount} ${b.currency}`)
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при проверка на баланса')
    }
  }

  const loading = !masterReady || (messagesQ.isLoading && !messagesQ.data)

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
      {/* Title bar */}
      <div className="px-3 py-2 md:px-5 md:py-3 flex flex-wrap gap-y-2 items-center justify-between border-b border-border bg-card">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base md:text-lg font-semibold text-foreground">✉️ Съобщения</h1>
          {balance && (
            <span className="text-xs text-muted-foreground ml-2">Баланс: <strong className="text-foreground tabular-nums">{balance}</strong></span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Табове — горе вдясно (консистентно с Каси и заеми). */}
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            {canSend && (
              <button
                onClick={() => setView('compose')}
                className={`px-3 py-1 text-sm font-semibold transition ${
                  view === 'compose'
                    ? 'bg-navy text-white dark:bg-primary dark:text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                Ново съобщение
              </button>
            )}
            <button
              onClick={() => setView('history')}
              className={`px-3 py-1 text-sm font-semibold transition ${
                view === 'history'
                  ? 'bg-navy text-white dark:bg-primary dark:text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              История
            </button>
          </div>
          {canSend && (
            <Button variant="outline" size="sm" onClick={() => void loadBalance()} title="Провери наличността в Mobica акаунта">
              <Wallet className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-6 text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Зареждане...
        </div>
      ) : view === 'compose' && canSend ? (
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          {/* ---------- Ляво: избор на клиенти ---------- */}
          <div className="lg:w-[44%] flex flex-col border-b lg:border-b-0 lg:border-r border-border min-h-0">
            <div className="px-3 py-2 border-b border-border bg-card flex flex-wrap items-center gap-2 text-xs">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Търси фирма..." className="h-7 pl-8 w-40 text-xs" />
              </div>
              {statusOptions.map(s => {
                const active = statusFilter.includes(s)
                return (
                  <button key={s}
                    onClick={() => setStatusFilter(prev => active ? prev.filter(x => x !== s) : [...prev, s])}
                    className={`px-2 py-0.5 rounded-full font-semibold transition ${active ? statusBadgeClass(s) : 'bg-muted/40 text-muted-foreground hover:bg-muted'}`}>
                    {s}
                  </button>
                )
              })}
              {accountantOptions.length > 0 && (
                <select value={accountantFilter} onChange={e => setAccountantFilter(e.target.value)}
                  className="h-6 px-1 text-xs border border-border rounded bg-background focus:border-primary">
                  <option value="">Всички счетоводители</option>
                  {accountantOptions.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              )}
              <button onClick={toggleAllVisible} className="ml-auto text-primary hover:underline font-semibold">
                Избери видимите
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {filteredRows.map((r, i) => {
                    const noPhone = !r.phone
                    const isSel = selected.has(r.clientId)
                    return (
                      <tr key={r.clientId}
                        onClick={() => { if (!noPhone) setSelected(prev => { const n = new Set(prev); if (n.has(r.clientId)) n.delete(r.clientId); else n.add(r.clientId); return n }) }}
                        className={`border-b border-border transition-colors ${noPhone ? 'opacity-50' : 'cursor-pointer hover:bg-gold/5'} ${isSel ? 'bg-sky-50 dark:bg-sky-900/20' : i % 2 === 0 ? 'bg-card' : 'bg-muted/20'}`}>
                        <td className="px-3 py-1.5 w-8">
                          <input type="checkbox" checked={isSel} disabled={noPhone} readOnly className="h-4 w-4 accent-sky-600 pointer-events-none" />
                        </td>
                        <td className="px-2 py-1.5 font-medium text-foreground">{r.name}</td>
                        <td className="px-2 py-1.5">
                          {r.status && <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${statusBadgeClass(r.status)}`}>{r.status}</span>}
                        </td>
                        <td className="px-2 py-1.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                          {noPhone ? <span className="text-rose-500" title="Няма телефон в Контакти (Собственик)">без телефон</span> : r.phone}
                        </td>
                        <td className="px-2 py-1.5 text-xs text-right tabular-nums text-muted-foreground whitespace-nowrap">
                          {r.amount != null ? `${fmtAmount(r.amount)} €` : ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 border-t border-border bg-card text-xs text-muted-foreground">
              Избрани: <strong className="text-foreground">{selected.size}</strong> • Телефоните идват от Контакти (Собственик)
            </div>
          </div>

          {/* ---------- Дясно: текст + preview + изпращане ---------- */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-border bg-card flex flex-wrap items-center gap-2 text-xs">
              <select
                onChange={e => {
                  const t = (templatesQ.data ?? []).find(t => t.id === e.target.value)
                  if (t) setBody(t.body)
                  e.target.value = ''
                }}
                defaultValue=""
                className="h-7 px-1 text-xs border border-border rounded bg-background focus:border-primary"
              >
                <option value="" disabled>Зареди шаблон...</option>
                {(templatesQ.data ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {isAdmin && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setTemplatesOpen(true)}>
                  <Pencil className="h-3 w-3 mr-1" /> Шаблони
                </Button>
              )}
              <span className="ml-auto text-muted-foreground">
                Работен месец: <strong className="text-foreground">{workMonthLabel}</strong> • Срок: <strong className="text-foreground">{deadline}</strong>
              </span>
            </div>
            <div className="p-3 border-b border-border">
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="Текст на съобщението... Ползвай {фирма}, {месец}, {сума}, {срок}"
                className="w-full text-sm border border-border rounded-lg p-2 bg-background focus:border-primary focus:outline-none resize-y"
              />
              <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                {(['{фирма}', '{месец}', '{сума}', '{срок}'] as const).map(p => (
                  <button key={p} onClick={() => setBody(b => b + p)}
                    className="px-1.5 py-0.5 rounded bg-muted/40 hover:bg-muted font-mono">{p}</button>
                ))}
                <span className="ml-auto tabular-nums">{body.length}/1000 • SMS fallback: до 67 знака на кирилица за 1 SMS</span>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {selectedRows.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Избери фирми отляво, за да видиш preview на съобщенията.</p>
              ) : (
                selectedRows.map(r => {
                  const resolved = resolveText(body, r)
                  const missingAmount = resolved.includes('{сума}')
                  const problem = !r.phone ? 'липсва телефон' : missingAmount ? 'липсва Резултат € за работния месец' : null
                  return (
                    <div key={r.clientId} className={`border rounded-lg p-2 text-sm ${problem ? 'border-rose-300 dark:border-rose-700/60 bg-rose-50/50 dark:bg-rose-900/10' : 'border-border bg-card'}`}>
                      <div className="flex items-center gap-2 text-xs mb-1">
                        <strong className="text-foreground">{r.name}</strong>
                        <span className="text-muted-foreground tabular-nums">{r.phone ?? '—'}</span>
                        {problem && <span className="text-rose-600 dark:text-rose-400 font-semibold ml-auto">⚠ {problem} — ще се пропусне</span>}
                      </div>
                      <p className="text-foreground whitespace-pre-wrap">{resolved || <span className="text-muted-foreground/50 italic">(празно съобщение)</span>}</p>
                    </div>
                  )
                })
              )}
            </div>
            <div className="px-3 py-2.5 border-t border-border bg-card flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Готови за изпращане: <strong className="text-foreground">{readyRows.length}</strong> от {selectedRows.length} избрани
              </span>
              <Button onClick={() => void doSend()} disabled={sending || readyRows.length === 0 || !body.trim()}>
                {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                Изпрати ({readyRows.length})
              </Button>
            </div>
          </div>
        </div>
      ) : (
        /* ---------- История ---------- */
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-3 md:px-5 py-2 border-b border-border bg-card flex items-center gap-3 text-xs">
            <span><strong className="text-foreground">{(messagesQ.data ?? []).length}</strong> съобщения (последните 500)</span>
            {canSend && (
              <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => void checkDlr()} disabled={checkingDlr}
                title="Проверява статусите на съобщенията от последните 24 часа (Mobica пази отчетите 24ч)">
                {checkingDlr ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                Обнови статуси
              </Button>
            )}
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse min-w-[900px]">
              <thead className="bg-navy text-white sticky top-0 z-30">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Дата</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Фирма</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Телефон</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider">Съобщение</th>
                  <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">Канал</th>
                  <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider whitespace-nowrap">Статус</th>
                </tr>
              </thead>
              <tbody>
                {(messagesQ.data ?? []).length === 0 && (
                  <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">Още няма изпратени съобщения.</td></tr>
                )}
                {(messagesQ.data ?? []).map((m, i) => (
                  <tr key={m.id} className={`border-b border-border ${i % 2 === 0 ? 'bg-card' : 'bg-muted/20'}`}>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(m.created_at)}</td>
                    <td className="px-3 py-1.5 font-medium text-foreground whitespace-nowrap">{m.client_name}</td>
                    <td className="px-3 py-1.5 text-xs tabular-nums text-muted-foreground whitespace-nowrap">{m.phone}</td>
                    <td className="px-3 py-1.5 text-xs text-foreground max-w-md truncate" title={m.text}>{m.text}</td>
                    <td className="px-3 py-1.5 text-center text-xs text-muted-foreground">{m.delivered_channel ?? '—'}</td>
                    <td className="px-3 py-1.5 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${STATUS_BADGE_CLS[m.status]}`}
                        title={m.status_desc ?? undefined}>
                        {MESSAGE_STATUS_LABELS[m.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {templatesOpen && isAdmin && (
        <TemplatesModal
          templates={templatesQ.data ?? []}
          onClose={() => setTemplatesOpen(false)}
          onChanged={() => invalidateMessageTemplates()}
        />
      )}
    </div>
  )
}

// ---------- Управление на шаблони (само admin) ----------
function TemplatesModal({ templates, onClose, onChanged }: {
  templates: MessageTemplate[]
  onClose: () => void
  onChanged: () => void
}) {
  const [saving, setSaving] = useState(false)
  async function withSave(fn: () => Promise<void>) {
    setSaving(true)
    try { await fn(); onChanged() } catch (e: any) { toast.error(e.message ?? 'Грешка') }
    setSaving(false)
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div onClick={e => e.stopPropagation()} className="bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">Шаблони за съобщения</h2>
            <p className="text-xs text-muted-foreground">Placeholder-и: {'{фирма} {месец} {сума} {срок}'}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {templates.map(t => (
            <TemplateRow key={t.id} template={t} disabled={saving}
              onUpdate={p => withSave(() => updateMessageTemplate(t.id, p))}
              onDelete={() => { if (window.confirm(`Изтриване на шаблон „${t.name}"?`)) void withSave(() => deleteMessageTemplate(t.id)) }}
            />
          ))}
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={saving}
            onClick={() => withSave(() => addMessageTemplate('Нов шаблон', ''))}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Нов шаблон
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>Затвори</Button>
        </div>
      </div>
    </div>
  )
}

function TemplateRow({ template, disabled, onUpdate, onDelete }: {
  template: MessageTemplate
  disabled?: boolean
  onUpdate: (p: { name?: string; body?: string }) => Promise<void>
  onDelete: () => void
}) {
  const [name, setName] = useState(template.name)
  const [body, setBody] = useState(template.body)
  return (
    <div className="border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Input value={name} onChange={e => setName(e.target.value)}
          onBlur={() => { if (name.trim() && name !== template.name) void onUpdate({ name: name.trim() }) }}
          disabled={disabled} className="h-7 text-sm font-semibold" />
        <button disabled={disabled} onClick={onDelete}
          className="text-muted-foreground hover:text-destructive p-1 disabled:opacity-40" title="Изтрий шаблон">
          <X className="h-4 w-4" />
        </button>
      </div>
      <textarea value={body} onChange={e => setBody(e.target.value)}
        onBlur={() => { if (body !== template.body) void onUpdate({ body }) }}
        disabled={disabled} rows={3} maxLength={1000}
        className="w-full text-sm border border-border rounded p-2 bg-background focus:border-primary focus:outline-none resize-y" />
    </div>
  )
}
