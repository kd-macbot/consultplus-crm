import { useMemo, useState, useEffect } from 'react'
import { toast } from 'sonner'
import { ShieldCheck, Search, Plus, Pencil, Trash2, AlertTriangle, Link2, Link2Off } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useAuth } from '../lib/auth'
import { useMyStaff } from '../lib/useMyStaff'
import {
  addClientCertificate, updateClientCertificate, deleteClientCertificate,
} from '../lib/storage'
import {
  useClientCertificates, useClients, useColumns, useCellValues, useInvalidateCrm,
} from '../lib/queries'
import type { ClientCertificate, ClientCertificatePatch } from '../lib/types'
import {
  clientCertStatus, daysLeft, expiryLabel, sortByUrgency, countByStatus,
  CERT_KIND_LABELS, CLIENT_CERT_STATUS_LABELS, CLIENT_CERT_STATUS_CLS,
  type ClientCertKind, type ClientCertStatus,
} from '../lib/clientCertificates'
import { normalizeSerial } from '../lib/certificates'
import { formatDate } from '../lib/utils'
import { usePersistentState } from '../lib/usePersistentState'
import { useRealtime } from '../lib/useRealtime'
import { makeDraftStore } from '../lib/formDraft'

// ============================================================
// Електронни подписи на КЛИЕНТИТЕ (мигр. 065).
//
// ⚠️ Друга страница от „Електронни подписи" (КЕП на кантората): там
// подписите носят ПИН и ПУК и ги виждат само admin + „Управление". Тук
// няма тайни — вижда ги всеки колега, защото счетоводителят трябва да
// знае кога изтича подписът на неговата фирма. Пишат admin + „Управление"
// (те поръчват подновяването и те получават напомнянията).
//
// ВРЪЗКАТА С ФИРМА Е РЪЧНА. Текстът „Подпис" от стария Excel смесва име
// на човек и на фирма в четири записа, а един ред понякога покрива
// няколко фирми — автоматично гадаене би сложило чужд подпис в картата на
// клиента, тихо. Затова `holder` е водещ, а фирмата се избира от човек.
// ============================================================

const todayIso = () => {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

type CertDraft = {
  holder: string; clientId: string | null; kind: string; serial: string
  validTo: string; requestNo: string; notes: string; paymentNotes: string
}
const certDraft = makeDraftStore<CertDraft>(
  'clientCertAddDraft',
  d => !!(d.holder?.trim() || d.serial?.trim() || d.validTo || d.notes?.trim()),
)

export function ClientCertificatesPage() {
  const { user } = useAuth()
  const { isAdmin, inDept } = useMyStaff()
  const canEdit = isAdmin || inDept('Управление')

  const certsQ = useClientCertificates()
  const { data: clients = [] } = useClients()
  const { data: columns = [] } = useColumns()
  const { data: cells = [] } = useCellValues()
  const { invalidateClientCertificates } = useInvalidateCrm()

  useRealtime({
    channel: 'client-certificates',
    tables: ['crm_client_certificates'],
    onChange: () => invalidateClientCertificates(),
  })

  const [search, setSearch] = usePersistentState('client-certs-search', '')
  const [statusFilter, setStatusFilter] = usePersistentState<'' | ClientCertStatus>('client-certs-status', '')
  const [onlyUnlinked, setOnlyUnlinked] = usePersistentState('client-certs-unlinked', false)
  const [modal, setModal] = useState<null | { existing?: ClientCertificate }>(
    () => (certDraft.hasContent() ? {} : null),
  )
  const [confirmDelete, setConfirmDelete] = useState<ClientCertificate | null>(null)
  const [saving, setSaving] = useState(false)

  const today = todayIso()
  const certs = useMemo(() => certsQ.data ?? [], [certsQ.data])

  // Име на фирмата = стойността на ПЪРВАТА text колона (EAV).
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

  const counts = useMemo(() => countByStatus(certs, today), [certs, today])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = certs.filter(c => {
      if (statusFilter && clientCertStatus(c.valid_to, today) !== statusFilter) return false
      if (onlyUnlinked && c.client_id) return false
      if (!q) return true
      const firm = c.client_id ? (nameByClient.get(c.client_id) ?? '') : ''
      return [c.holder, c.serial_number ?? '', c.notes ?? '', c.payment_notes ?? '', c.request_no ?? '', firm]
        .some(v => v.toLowerCase().includes(q))
    })
    return sortByUrgency(filtered, today)
  }, [certs, search, statusFilter, onlyUnlinked, today, nameByClient])

  async function save(patch: ClientCertificatePatch, existing?: ClientCertificate) {
    setSaving(true)
    try {
      const audit = { userId: user?.id, userName: user?.full_name ?? '', label: patch.holder ?? existing?.holder ?? '' }
      if (existing) await updateClientCertificate(existing.id, patch, audit)
      else await addClientCertificate(patch, audit)
      certDraft.clear()
      toast.success(existing ? 'Записано' : 'Подписът е добавен')
      await invalidateClientCertificates()
      setModal(null)
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
    } finally {
      setSaving(false)
    }
  }

  async function remove(cert: ClientCertificate) {
    try {
      await deleteClientCertificate(cert.id, {
        userId: user?.id, userName: user?.full_name ?? '', label: cert.holder,
      })
      toast.success('Изтрито')
      await invalidateClientCertificates()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка')
    } finally {
      setConfirmDelete(null)
    }
  }

  const chip = (key: '' | ClientCertStatus, label: string, n: number, cls = '') => (
    <button
      key={key || 'all'}
      type="button"
      onClick={() => setStatusFilter(statusFilter === key ? '' : key)}
      className={`rounded-lg border px-3 py-2 text-left transition ${
        statusFilter === key ? 'border-navy ring-1 ring-navy' : 'border-border hover:bg-muted/50'
      }`}
    >
      <div className={`text-xl font-bold ${cls}`}>{n}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-navy dark:text-foreground flex items-center gap-2">
          <ShieldCheck className="h-6 w-6" /> Подписи на клиенти
        </h1>
        {canEdit && (
          <Button onClick={() => setModal({})} className="gap-1.5">
            <Plus className="h-4 w-4" /> Нов подпис
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {chip('', 'Всички', counts.total)}
        {chip('expired', 'Изтекли', counts.expired, 'text-rose-600')}
        {chip('expiring', 'Изтичат до 30 дни', counts.expiring, 'text-amber-600')}
        {chip('valid', 'Валидни', counts.valid, 'text-emerald-600')}
        {chip('unknown', 'Без дата', counts.unknown, 'text-muted-foreground')}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Търси по име, сериен номер, бележка..."
            className="pl-8"
          />
        </div>
        <Button
          type="button"
          variant={onlyUnlinked ? 'default' : 'outline'}
          onClick={() => setOnlyUnlinked(!onlyUnlinked)}
          className="gap-1.5"
          title="Редове, които още не са свързани с фирма от Клиенти"
        >
          <Link2Off className="h-4 w-4" /> Несвързани ({counts.unlinked})
        </Button>
      </div>

      {counts.unlinked > 0 && (
        <div className="rounded-lg border border-sky-300 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/20 p-3 text-[13px] text-sky-900 dark:text-sky-200">
          <p>
            <strong>{counts.unlinked}</strong> {counts.unlinked === 1 ? 'подпис не е свързан' : 'подписа не са свързани'} с
            фирма. Свързването е ръчно нарочно: в стария файл една клетка смесва име на човек и на фирма, а понякога
            покрива няколко фирми — автоматично налучкване би показало чужд подпис в картата на клиента.
          </p>
        </div>
      )}

      {certsQ.isLoading ? (
        <p className="text-muted-foreground">Зареждане...</p>
      ) : visible.length === 0 ? (
        <p className="text-muted-foreground">Няма подписи по този филтър.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Подпис</th>
                <th className="px-3 py-2 font-medium">Фирма</th>
                <th className="px-3 py-2 font-medium">Вид</th>
                <th className="px-3 py-2 font-medium">Сериен номер</th>
                <th className="px-3 py-2 font-medium">Валиден до</th>
                <th className="px-3 py-2 font-medium">Заявка</th>
                <th className="px-3 py-2 font-medium">Бележки</th>
                {canEdit && <th className="px-3 py-2 w-20" />}
              </tr>
            </thead>
            <tbody>
              {visible.map(c => {
                const st = clientCertStatus(c.valid_to, today)
                const left = daysLeft(c.valid_to, today)
                const firm = c.client_id ? nameByClient.get(c.client_id) : null
                return (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{c.holder}</td>
                    <td className="px-3 py-2">
                      {firm ? (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <Link2 className="h-3 w-3 text-muted-foreground" />{firm}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50 text-xs">несвързан</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {c.cert_kind ? CERT_KIND_LABELS[c.cert_kind] : <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {c.serial_number ?? (
                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" /> липсва
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${CLIENT_CERT_STATUS_CLS[st]}`}>
                        {c.valid_to ? formatDate(c.valid_to) : CLIENT_CERT_STATUS_LABELS.unknown}
                      </span>
                      {left !== null && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">{expiryLabel(left)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{c.request_no ?? ''}</td>
                    <td className="px-3 py-2 text-xs max-w-[280px]">
                      <div className="whitespace-pre-wrap">{c.notes ?? ''}</div>
                      {c.payment_notes && (
                        <div className="text-muted-foreground mt-0.5">{c.payment_notes}</div>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7"
                            onClick={() => setModal({ existing: c })} title="Редактирай">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                            onClick={() => setConfirmDelete(c)} title="Изтрий">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && canEdit && (
        <CertModal
          existing={modal.existing}
          clients={clients}
          nameByClient={nameByClient}
          saving={saving}
          onClose={() => { certDraft.clear(); setModal(null) }}
          onSave={patch => void save(patch, modal.existing)}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onCancel={() => setConfirmDelete(null)}
        title="Да изтрия ли подписа?"
        description={`„${confirmDelete?.holder ?? ''}" ще бъде премахнат от списъка. Действието не може да се върне.`}
        confirmLabel="Изтрий"
        destructive
        onConfirm={() => { if (confirmDelete) void remove(confirmDelete) }}
      />
    </div>
  )
}

// ============================================================
// Модал: нов / редакция
// ============================================================
function CertModal({
  existing, clients, nameByClient, saving, onClose, onSave,
}: {
  existing?: ClientCertificate
  clients: { id: string }[]
  nameByClient: Map<string, string>
  saving: boolean
  onClose: () => void
  onSave: (patch: ClientCertificatePatch) => void
}) {
  const draft = existing ? null : certDraft.read()
  const [holder, setHolder] = useState(existing?.holder ?? draft?.holder ?? '')
  const [clientId, setClientId] = useState<string | null>(existing?.client_id ?? draft?.clientId ?? null)
  const [clientSearch, setClientSearch] = useState('')
  const [kind, setKind] = useState<string>(existing?.cert_kind ?? draft?.kind ?? '')
  const [serial, setSerial] = useState(existing?.serial_number ?? draft?.serial ?? '')
  const [validTo, setValidTo] = useState(existing?.valid_to ?? draft?.validTo ?? '')
  const [requestNo, setRequestNo] = useState(existing?.request_no ?? draft?.requestNo ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? draft?.notes ?? '')
  const [paymentNotes, setPaymentNotes] = useState(existing?.payment_notes ?? draft?.paymentNotes ?? '')

  useEffect(() => {
    if (existing) return
    certDraft.write({ holder, clientId, kind, serial, validTo, requestNo, notes, paymentNotes })
  }, [existing, holder, clientId, kind, serial, validTo, requestNo, notes, paymentNotes])

  useEffect(() => {
    if (draft) toast.info('Възстановена е незапазена чернова от предишен опит.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // Проверката на серийния номер е ОБЩА с подписите на кантората — същият
  // капан с научния запис от Excel, същото решение.
  const serialCheck = normalizeSerial(serial)
  const matching = useMemo(() => {
    const q = clientSearch.trim().toLowerCase()
    if (!q) return []
    return clients
      .map(c => ({ id: c.id, name: nameByClient.get(c.id) ?? '' }))
      .filter(c => c.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
      .slice(0, 8)
  }, [clients, nameByClient, clientSearch])

  const canSave = holder.trim() && !serialCheck.error && !saving

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? 'Редактирай подпис' : 'Нов подпис'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cc-holder">Подпис (на кого е) *</Label>
            <Input id="cc-holder" value={holder} onChange={e => setHolder(e.target.value)}
              placeholder="напр. Росица Диева (Флорета фешън)" autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label>Фирма от Клиенти</Label>
            {clientId ? (
              <div className="flex items-center gap-2">
                <span className="flex-1 rounded-md border border-border px-3 py-2 text-sm">
                  {nameByClient.get(clientId) ?? 'непозната фирма'}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => setClientId(null)}>
                  Премахни
                </Button>
              </div>
            ) : (
              <>
                <Input value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                  placeholder="търси фирма..." />
                {matching.length > 0 && (
                  <div className="rounded-md border border-border divide-y divide-border">
                    {matching.map(c => (
                      <button key={c.id} type="button"
                        onClick={() => { setClientId(c.id); setClientSearch('') }}
                        className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted/60">
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  По избор. Свържеш ли го, подписът се вижда и в картата на клиента.
                </p>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cc-kind">Вид</Label>
              <select id="cc-kind" value={kind} onChange={e => setKind(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <option value="">—</option>
                {(Object.keys(CERT_KIND_LABELS) as ClientCertKind[]).map(k => (
                  <option key={k} value={k}>{CERT_KIND_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-valid">Валиден до</Label>
              <Input id="cc-valid" type="date" value={validTo} onChange={e => setValidTo(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cc-serial">Сериен номер</Label>
            <Input id="cc-serial" value={serial} onChange={e => setSerial(e.target.value)}
              className="font-mono" placeholder="само цифри" />
            {serialCheck.error && (
              <p className="text-xs text-destructive flex items-start gap-1">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{serialCheck.error}
              </p>
            )}
            {!serialCheck.error && serialCheck.warning && (
              <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{serialCheck.warning}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cc-req">Номер на заявката</Label>
            <Input id="cc-req" value={requestNo} onChange={e => setRequestNo(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cc-notes">Бележки</Label>
            <textarea id="cc-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cc-pay">Бележки за плащане</Label>
            <Input id="cc-pay" value={paymentNotes} onChange={e => setPaymentNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отказ</Button>
          <Button
            disabled={!canSave}
            onClick={() => onSave({
              holder: holder.trim(),
              client_id: clientId,
              cert_kind: (kind || null) as ClientCertKind | null,
              serial_number: serialCheck.value || null,
              valid_to: validTo || null,
              request_no: requestNo.trim() || null,
              notes: notes.trim() || null,
              payment_notes: paymentNotes.trim() || null,
            })}
          >
            {saving ? 'Записване...' : 'Запази'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
