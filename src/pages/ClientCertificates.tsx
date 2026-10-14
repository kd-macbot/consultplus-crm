import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
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
  useClientCertificates, useClients, useColumns, useCellValues, useContactsWithClients,
  useInvalidateCrm, qk,
} from '../lib/queries'
import { queryClient } from '../lib/queryClient'
import type { ClientCertificate, ClientCertificatePatch } from '../lib/types'
import {
  clientCertStatus, daysLeft, expiryLabel, sortByUrgency, countByStatus,
  certLabel, isUnlinked,
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
  holder: string; clientId: string | null; standalone: boolean; kind: string
  serial: string; validTo: string; requestNo: string; notes: string; paymentNotes: string
}
const certDraft = makeDraftStore<CertDraft>(
  'clientCertAddDraft',
  d => !!(d.holder?.trim() || d.serial?.trim() || d.validTo || d.notes?.trim()),
)

/**
 * Текстово поле ПРЯКО В РЕДА. Изглежда като текст, докато не го пипнеш.
 *
 * Записва се при НАПУСКАНЕ на полето (или Enter), не на всеки знак: иначе
 * едно изречение би пратило трийсет заявки. Escape връща старото.
 *
 * `onFocusChange` казва на страницата, че се пише — докато е true,
 * споделеното презареждане от Realtime изчаква. Без това промяна от колега
 * щеше да презапише полето изпод ръцете на пишещия.
 */
function InlineText({
  value, onSave, onFocusChange, placeholder, multiline, disabled, failed,
}: {
  value: string | null
  onSave: (next: string | null) => void
  onFocusChange: (focused: boolean) => void
  placeholder?: string
  multiline?: boolean
  disabled?: boolean
  failed?: boolean
}) {
  const [draft, setDraft] = useState(value ?? '')
  const [focused, setFocused] = useState(false)

  // Докато полето НЕ е на фокус, то следва данните (промяна от колега,
  // презареждане). На фокус — не, иначе написаното би изчезнало.
  useEffect(() => {
    if (!focused) setDraft(value ?? '')
  }, [value, focused])

  // Ако редът изчезне, докато полето е на фокус (смяна на филтър, търсене),
  // onBlur НЕ се изпълнява и броячът на страницата остава вдигнат — тогава
  // презареждането се отлага завинаги. Затова се отписваме и при размонтиране.
  const focusedRef = useRef(false)
  focusedRef.current = focused
  const notify = useRef(onFocusChange)
  notify.current = onFocusChange
  useEffect(() => () => { if (focusedRef.current) notify.current(false) }, [])

  if (disabled) {
    return value
      ? <span className="whitespace-pre-wrap">{value}</span>
      : <span className="text-muted-foreground/40">—</span>
  }

  const commit = () => {
    setFocused(false)
    onFocusChange(false)
    const next = draft.trim() || null
    if (next !== (value ?? null)) onSave(next)
  }

  const cls = `w-full bg-transparent rounded px-1 py-0.5 text-xs outline-none transition
    hover:bg-muted/60 focus:bg-background focus:ring-1 focus:ring-navy
    ${failed ? 'ring-1 ring-amber-500' : ''}`

  const common = {
    value: draft,
    placeholder,
    onFocus: () => { setFocused(true); onFocusChange(true) },
    onBlur: commit,
    className: cls,
    title: failed ? 'Записът не мина — стойността стои само на твоя екран' : undefined,
  }

  if (multiline) {
    return (
      <textarea
        {...common}
        rows={Math.min(4, Math.max(1, draft.split('\n').length))}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          // Enter прави нов ред; записът е с Escape-less напускане или Ctrl+Enter.
          if (e.key === 'Escape') { setDraft(value ?? ''); (e.target as HTMLTextAreaElement).blur() }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur()
        }}
      />
    )
  }
  return (
    <input
      {...common}
      onChange={e => setDraft(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { setDraft(value ?? ''); (e.target as HTMLInputElement).blur() }
      }}
    />
  )
}

export function ClientCertificatesPage() {
  const { user } = useAuth()
  const { isAdmin, inDept } = useMyStaff()
  const canEdit = isAdmin || inDept('Управление')

  const certsQ = useClientCertificates()
  const { data: clients = [] } = useClients()
  const { data: columns = [] } = useColumns()
  const { data: cells = [] } = useCellValues()
  const { data: contacts = [] } = useContactsWithClients()
  const { invalidateClientCertificates } = useInvalidateCrm()

  // Колко полета в таблицата са на фокус в момента. Докато е > 0, не
  // презареждаме — свежите данни биха презаписали полето изпод ръцете.
  const editingRef = useRef(0)
  const setEditing = useCallback((focused: boolean) => {
    editingRef.current = Math.max(0, editingRef.current + (focused ? 1 : -1))
  }, [])

  useRealtime({
    channel: 'client-certificates',
    tables: ['crm_client_certificates'],
    onChange: () => invalidateClientCertificates(),
    shouldDefer: () => editingRef.current > 0,
  })

  // Полета, чийто запис се е провалил — стойността стои само на екрана и
  // това ТРЯБВА да се вижда, иначе таблицата лъже тихо.
  const [failed, setFailed] = useState<Set<string>>(new Set())

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

  // Собственикът по фирма — попълва се сам при избор на фирма, за да не се
  // преписва на ръка. Контактите вече го поддържат.
  const ownerByClient = useMemo(() => {
    const m = new Map<string, string>()
    contacts.forEach(c => { if (c.owner_name?.trim()) m.set(c.client_id, c.owner_name.trim()) })
    return m
  }, [contacts])

  const counts = useMemo(() => countByStatus(certs, today), [certs, today])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = certs.filter(c => {
      if (statusFilter && clientCertStatus(c.valid_to, today) !== statusFilter) return false
      if (onlyUnlinked && !isUnlinked(c)) return false
      if (!q) return true
      const firm = c.client_id ? (nameByClient.get(c.client_id) ?? '') : ''
      return [c.holder ?? '', c.serial_number ?? '', c.notes ?? '', c.payment_notes ?? '', c.request_no ?? '', firm]
        .some(v => v.toLowerCase().includes(q))
    })
    return sortByUrgency(filtered, today)
  }, [certs, search, statusFilter, onlyUnlinked, today, nameByClient])

  async function save(patch: ClientCertificatePatch, existing?: ClientCertificate) {
    setSaving(true)
    try {
      const label = patch.client_id
        ? (nameByClient.get(patch.client_id) ?? '')
        : (patch.holder || existing?.holder || '')
      const audit = { userId: user?.id, userName: user?.full_name ?? '', label }
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

  /**
   * Запис на едно поле от реда. Оптимистичен: стойността влиза в кеша
   * веднага, за да не „подскача" полето.
   *
   * ПРИ ГРЕШКА НЕ инвалидираме — това би върнало старата стойност и би
   * изтрило написаното (цял клас бъгове в този проект). Вместо това полето
   * остава и се маркира, че не е записано.
   */
  const saveField = useCallback(async (
    cert: ClientCertificate,
    field: 'request_no' | 'notes' | 'payment_notes',
    next: string | null,
  ) => {
    const key = `${cert.id}:${field}`
    queryClient.setQueryData<ClientCertificate[]>(qk.clientCertificates, rows =>
      (rows ?? []).map(r => (r.id === cert.id ? { ...r, [field]: next } : r)))
    try {
      await updateClientCertificate(cert.id, { [field]: next }, {
        userId: user?.id, userName: user?.full_name ?? '', label: cert.holder ?? '',
      })
      setFailed(prev => {
        if (!prev.has(key)) return prev
        const n = new Set(prev); n.delete(key); return n
      })
    } catch (e: any) {
      setFailed(prev => new Set(prev).add(key))
      toast.error(e.message ?? 'Записът не мина — стойността стои само на твоя екран')
    }
  }, [user?.id, user?.full_name])

  async function remove(cert: ClientCertificate) {
    try {
      await deleteClientCertificate(cert.id, {
        userId: user?.id, userName: user?.full_name ?? '',
        label: certLabel(cert, cert.client_id ? nameByClient.get(cert.client_id) : null).primary,
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
            <strong>{counts.unlinked}</strong> {counts.unlinked === 1 ? 'подпис чака' : 'подписа чакат'} свързване с
            фирма. Отвори реда, избери фирмата от списъка и името на собственика ще се попълни само от Контакти.
            Ако подписът не е на наш клиент, отбележи го като <strong>изолиран случай</strong> и напиши на кого е.
            Свързването е ръчно нарочно: в стария файл една клетка смесва име на човек и на фирма, а понякога
            покрива няколко фирми — налучкване би показало чужд подпис в картата на клиента.
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
                <th className="px-3 py-2 font-medium">Фирма / случай</th>
                <th className="px-3 py-2 font-medium">Подпис на</th>
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
                const label = certLabel(c, firm)
                return (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="font-medium">{label.primary}</div>
                      {c.is_standalone && (
                        <div className="text-[11px] text-muted-foreground">изолиран случай</div>
                      )}
                      {isUnlinked(c) && (
                        <div className="text-[11px] text-amber-700 dark:text-amber-400 inline-flex items-center gap-1">
                          <Link2Off className="h-3 w-3" /> чака свързване
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {c.client_id
                        ? (c.holder?.trim()
                            ? <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3 text-muted-foreground" />{c.holder}</span>
                            : <span className="text-muted-foreground/50">—</span>)
                        : <span className="text-muted-foreground/50">—</span>}
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
                    {/* Заявката и бележките се пишат ПРЯКО в реда — те се
                        променят най-често, докато се гони подновяване, и
                        диалог заради един ред е излишен. */}
                    <td className="px-3 py-2 text-xs align-top min-w-[130px]">
                      <InlineText
                        value={c.request_no}
                        disabled={!canEdit}
                        failed={failed.has(`${c.id}:request_no`)}
                        placeholder="—"
                        onFocusChange={setEditing}
                        onSave={next => void saveField(c, 'request_no', next)}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs align-top min-w-[240px]">
                      <InlineText
                        value={c.notes}
                        disabled={!canEdit}
                        failed={failed.has(`${c.id}:notes`)}
                        placeholder="бележка..."
                        multiline
                        onFocusChange={setEditing}
                        onSave={next => void saveField(c, 'notes', next)}
                      />
                      <div className="text-muted-foreground">
                        <InlineText
                          value={c.payment_notes}
                          disabled={!canEdit}
                          failed={failed.has(`${c.id}:payment_notes`)}
                          placeholder="за плащане..."
                          onFocusChange={setEditing}
                          onSave={next => void saveField(c, 'payment_notes', next)}
                        />
                      </div>
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
          ownerByClient={ownerByClient}
          saving={saving}
          onClose={() => { certDraft.clear(); setModal(null) }}
          onSave={patch => void save(patch, modal.existing)}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onCancel={() => setConfirmDelete(null)}
        title="Да изтрия ли подписа?"
        description={`„${confirmDelete ? certLabel(confirmDelete, confirmDelete.client_id ? nameByClient.get(confirmDelete.client_id) : null).primary : ''}" ще бъде премахнат от списъка. Действието не може да се върне.`}
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
  existing, clients, nameByClient, ownerByClient, saving, onClose, onSave,
}: {
  existing?: ClientCertificate
  clients: { id: string }[]
  nameByClient: Map<string, string>
  ownerByClient: Map<string, string>
  saving: boolean
  onClose: () => void
  onSave: (patch: ClientCertificatePatch) => void
}) {
  const draft = existing ? null : certDraft.read()
  const [holder, setHolder] = useState(existing?.holder ?? draft?.holder ?? '')
  const [clientId, setClientId] = useState<string | null>(existing?.client_id ?? draft?.clientId ?? null)
  const [standalone, setStandalone] = useState(existing?.is_standalone ?? draft?.standalone ?? false)
  const [clientSearch, setClientSearch] = useState('')
  const [kind, setKind] = useState<string>(existing?.cert_kind ?? draft?.kind ?? '')
  const [serial, setSerial] = useState(existing?.serial_number ?? draft?.serial ?? '')
  const [validTo, setValidTo] = useState(existing?.valid_to ?? draft?.validTo ?? '')
  const [requestNo, setRequestNo] = useState(existing?.request_no ?? draft?.requestNo ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? draft?.notes ?? '')
  const [paymentNotes, setPaymentNotes] = useState(existing?.payment_notes ?? draft?.paymentNotes ?? '')

  useEffect(() => {
    if (existing) return
    certDraft.write({ holder, clientId, standalone, kind, serial, validTo, requestNo, notes, paymentNotes })
  }, [existing, holder, clientId, standalone, kind, serial, validTo, requestNo, notes, paymentNotes])

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

  /** Избор на фирма → собственикът се попълва сам, ако полето е още празно. */
  function pickClient(id: string) {
    setClientId(id)
    setStandalone(false)
    setClientSearch('')
    if (!holder.trim()) setHolder(ownerByClient.get(id) ?? '')
  }

  // Фирма ИЛИ изолиран случай с име — едното от двете.
  const canSave = (clientId || (standalone && holder.trim())) && !serialCheck.error && !saving

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? 'Редактирай подпис' : 'Нов подпис'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* ФИРМАТА Е ПЪРВА И СЕ ИЗБИРА, не се пише — това е смисълът на
              пренареждането. Собственикът идва сам от Контакти. */}
          <div className="space-y-1.5">
            <Label>Фирма *</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStandalone(false)}
                className={`flex-1 rounded-md border px-3 py-1.5 text-sm transition ${
                  !standalone ? 'border-navy ring-1 ring-navy font-medium' : 'border-border hover:bg-muted/50'
                }`}
              >
                Наш клиент
              </button>
              <button
                type="button"
                onClick={() => { setStandalone(true); setClientId(null); setClientSearch('') }}
                className={`flex-1 rounded-md border px-3 py-1.5 text-sm transition ${
                  standalone ? 'border-navy ring-1 ring-navy font-medium' : 'border-border hover:bg-muted/50'
                }`}
              >
                Изолиран случай
              </button>
            </div>

            {standalone ? (
              <p className="text-xs text-muted-foreground">
                Физическо лице или фирма, която не обслужваме. Напиши по-долу на кого е подписът.
              </p>
            ) : clientId ? (
              <div className="flex items-center gap-2">
                <span className="flex-1 rounded-md border border-border px-3 py-2 text-sm">
                  {nameByClient.get(clientId) ?? 'непозната фирма'}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => setClientId(null)}>
                  Смени
                </Button>
              </div>
            ) : (
              <>
                <Input value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                  placeholder="търси фирма..." autoFocus />
                {matching.length > 0 && (
                  <div className="rounded-md border border-border divide-y divide-border max-h-52 overflow-y-auto">
                    {matching.map(c => (
                      <button key={c.id} type="button" onClick={() => pickClient(c.id)}
                        className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted/60">
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cc-holder">
              {standalone ? 'На кого е подписът *' : 'Подпис на (собственик)'}
            </Label>
            <Input id="cc-holder" value={holder} onChange={e => setHolder(e.target.value)}
              placeholder={standalone ? 'име на лицето или фирмата' : 'попълва се сам от Контакти'} />
            {!standalone && (
              <p className="text-xs text-muted-foreground">
                По избор. При избор на фирма се взима от Контакти, ако е попълнен там.
              </p>
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
              holder: holder.trim() || null,
              client_id: standalone ? null : clientId,
              is_standalone: standalone,
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
