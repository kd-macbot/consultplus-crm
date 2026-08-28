import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  KeyRound, Search, Plus, Pencil, Trash2, Eye, EyeOff, Copy, Loader2, AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useAuth } from '../lib/auth'
import { useMyStaff } from '../lib/useMyStaff'
import { addCertificate, updateCertificate, deleteCertificate } from '../lib/storage'
import { useCertificates, useStaff, useInvalidateCrm } from '../lib/queries'
import type { Certificate, CertificatePatch } from '../lib/types'
import {
  certStatus, daysLeft, normalizeSerial, CERT_STATUS_LABELS, CERT_STATUS_CLS, EXPIRING_DAYS,
  type CertStatus,
} from '../lib/certificates'
import { formatDate } from '../lib/utils'
import { usePersistentState } from '../lib/usePersistentState'
import { useRealtime } from '../lib/useRealtime'

// ============================================================
// Електронни подписи (КЕП) — инвентар.
//
// Всички подписи са издадени на СОБСТВЕНИКА и се зачисляват на колеги.
// Подпис без зачислен колега е свободен.
//
// Достъп: admin + мениджъри от отдел „Управление" (route + гейт тук +
// RLS). Редът съдържа ПИН и ПУК — затова защитата е и в базата, не само
// в UI, за разлика от Банков достъп.
// ============================================================

const pad = (n: number) => String(n).padStart(2, '0')

/** Клетка за ПИН/ПУК — маскирана, с „покажи" и копиране (както Банков достъп). */
function SecretCell({ value }: { value: string | null }) {
  const [shown, setShown] = useState(false)
  if (!value) return <span className="text-muted-foreground/40">—</span>
  return (
    <div className="flex items-center gap-1">
      <span className="font-mono text-xs tabular-nums">{shown ? value : '••••'}</span>
      <button
        type="button" onClick={() => setShown(s => !s)}
        className="text-muted-foreground hover:text-foreground shrink-0"
        title={shown ? 'Скрий' : 'Покажи'}
      >
        {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => { navigator.clipboard?.writeText(value); toast.success('Копирано') }}
        className="text-muted-foreground hover:text-foreground shrink-0"
        title="Копирай"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

type Filter = 'all' | CertStatus

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'Всички' },
  { key: 'free', label: 'Свободни' },
  { key: 'assigned', label: 'Зачислени' },
  { key: 'expiring', label: 'Изтичащи' },
  { key: 'expired', label: 'Изтекли' },
]

export function CertificatesPage() {
  const { user } = useAuth()
  const { inDept } = useMyStaff()
  const isAdmin = user?.role === 'admin'
  const canUse = isAdmin || (user?.role === 'manager' && inDept('Управление'))

  const certsQ = useCertificates()
  const staffQ = useStaff()
  const { invalidateCertificates } = useInvalidateCrm()

  const certs = useMemo(() => certsQ.data ?? [], [certsQ.data])
  const staff = useMemo(() => staffQ.data ?? [], [staffQ.data])
  const staffName = useMemo(() => {
    const m = new Map<string, string>()
    staff.forEach(s => m.set(s.id, s.full_name))
    return m
  }, [staff])

  useRealtime({
    channel: 'certificates',
    tables: ['crm_certificates'],
    onChange: () => invalidateCertificates(),
  })

  const todayIso = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }, [])

  const [search, setSearch] = usePersistentState('cert-search', '')
  const [filter, setFilter] = usePersistentState<Filter>('cert-filter', 'all')
  const [editFor, setEditFor] = useState<Certificate | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Certificate | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  type Row = Certificate & { status: CertStatus; assignee: string; left: number | null }
  const rows: Row[] = useMemo(() => certs.map(c => ({
    ...c,
    status: certStatus(c.valid_to, c.assigned_staff_id, todayIso),
    assignee: c.assigned_staff_id ? (staffName.get(c.assigned_staff_id) ?? '(изтрит колега)') : '',
    left: daysLeft(c.valid_to, todayIso),
  })), [certs, staffName, todayIso])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return rows.filter(r => {
      if (filter !== 'all' && r.status !== filter) return false
      if (!s) return true
      return [r.device_no, r.serial_number, r.assignee, r.notes, r.owner_cn]
        .some(v => (v ?? '').toLowerCase().includes(s))
    })
  }, [rows, search, filter])

  const stats = useMemo(() => ({
    total: rows.length,
    free: rows.filter(r => r.status === 'free').length,
    expiring: rows.filter(r => r.status === 'expiring').length,
    expired: rows.filter(r => r.status === 'expired').length,
  }), [rows])

  async function reassign(cert: Certificate, staffId: string) {
    setSavingId(cert.id)
    try {
      await updateCertificate(cert.id, { assigned_staff_id: staffId || null }, {
        userId: user?.id,
        userName: user?.full_name ?? '',
        oldAssignee: cert.assigned_staff_id ? (staffName.get(cert.assigned_staff_id) ?? '') : '',
        newAssignee: staffId ? (staffName.get(staffId) ?? '') : '',
      })
      toast.success(staffId ? `Зачислен на ${staffName.get(staffId)}` : 'Подписът е освободен')
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при запис')
    } finally {
      invalidateCertificates()
      setSavingId(null)
    }
  }

  async function remove(cert: Certificate) {
    setConfirmDelete(null)
    try {
      await deleteCertificate(cert.id, {
        userId: user?.id,
        userName: user?.full_name ?? '',
        label: cert.device_no ? `подпис №${cert.device_no}` : (cert.serial_number ?? ''),
      })
      toast.success('Подписът е изтрит')
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при изтриване')
    } finally {
      invalidateCertificates()
    }
  }

  if (!canUse) {
    return (
      <div className="p-5 text-sm text-muted-foreground">
        Страницата е достъпна само за администратори и отдел „Управление".
      </div>
    )
  }

  const loading = certsQ.isLoading && !certsQ.data

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
      {/* Заглавна лента */}
      <div className="px-3 py-2 md:px-5 md:py-3 flex flex-wrap gap-y-2 items-center justify-between border-b border-border bg-card">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-base md:text-lg font-semibold text-foreground flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Електронни подписи
          </h1>
          <span className="text-xs text-muted-foreground">
            <strong className="text-foreground">{stats.total}</strong> общо
            {stats.free > 0 && <> · <strong className="text-sky-700 dark:text-sky-400">{stats.free}</strong> свободни</>}
            {stats.expiring > 0 && <> · <strong className="text-amber-700 dark:text-amber-400">{stats.expiring}</strong> изтичащи</>}
            {stats.expired > 0 && <> · <strong className="text-rose-700 dark:text-rose-400">{stats.expired}</strong> изтекли</>}
          </span>
        </div>
        <Button size="sm" onClick={() => setEditFor('new')}>
          <Plus className="h-4 w-4 mr-1" /> Нов подпис
        </Button>
      </div>

      {/* Филтри */}
      <div className="px-3 md:px-5 py-2 border-b border-border bg-card flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2 py-0.5 rounded-full font-semibold transition ${
                filter === f.key
                  ? 'bg-amber-200 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100'
                  : 'bg-muted/40 text-muted-foreground hover:bg-muted'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Търси по номер, колега, бележка…"
            className="h-8 pl-7 w-56 text-xs"
          />
        </div>
      </div>

      {/* Таблица */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-6 text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Зареждане…
          </div>
        ) : (
          <table className="w-full border-collapse min-w-[1100px]">
            <thead className="bg-navy text-white sticky top-0 z-30">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider w-12">№</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider">Сериен номер</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Валиден до</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider">Зачислен на</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider">Статус</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider w-24">ПИН</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider w-32">ПУК</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider">Бележка</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-10 text-center text-muted-foreground">
                    {certs.length === 0
                      ? 'Още няма въведени подписи — добави първия с бутона горе.'
                      : 'Няма подписи по този филтър.'}
                  </td>
                </tr>
              )}
              {filtered.map((r, i) => {
                const evenBg = i % 2 === 0 ? 'bg-card' : 'bg-muted/20'
                return (
                  <tr key={r.id} className={`border-b border-border hover:bg-gold/5 transition-colors ${evenBg}`}>
                    <td className="px-3 py-1.5 font-semibold text-foreground">{r.device_no || '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-foreground whitespace-nowrap">
                      {r.serial_number || <span className="text-muted-foreground/40 italic">не е въведен</span>}
                    </td>
                    <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                      {r.valid_to ? (
                        <>
                          {formatDate(r.valid_to)}
                          {r.left !== null && r.left >= 0 && r.left <= EXPIRING_DAYS && (
                            <span className="ml-1 text-amber-700 dark:text-amber-400">({r.left} дни)</span>
                          )}
                          {r.left !== null && r.left < 0 && (
                            <span className="ml-1 text-rose-600 dark:text-rose-400">(изтекъл)</span>
                          )}
                        </>
                      ) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-3 py-1">
                      <select
                        value={r.assigned_staff_id ?? ''}
                        disabled={savingId === r.id}
                        onChange={e => void reassign(r, e.target.value)}
                        className="h-7 w-full max-w-[190px] rounded border border-border bg-background px-1.5 text-xs focus:border-primary focus:outline-none"
                      >
                        <option value="">— свободен —</option>
                        {staff.map(s => (
                          <option key={s.id} value={s.id}>{s.full_name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${CERT_STATUS_CLS[r.status]}`}>
                        {CERT_STATUS_LABELS[r.status]}
                      </span>
                    </td>
                    <td className="px-3 py-1.5"><SecretCell value={r.pin} /></td>
                    <td className="px-3 py-1.5"><SecretCell value={r.puk} /></td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground max-w-[220px] truncate" title={r.notes ?? ''}>
                      {r.notes || '—'}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setEditFor(r)} title="Редакция"
                          className="text-muted-foreground hover:text-foreground">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setConfirmDelete(r)} title="Изтрий"
                          className="text-muted-foreground hover:text-rose-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {editFor && (
        <CertificateForm
          cert={editFor === 'new' ? null : editFor}
          staff={staff}
          onClose={() => setEditFor(null)}
          onSaved={() => { setEditFor(null); invalidateCertificates() }}
          user={user}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Да изтрия ли подписа?"
        description={confirmDelete
          ? `№${confirmDelete.device_no || '—'}${confirmDelete.serial_number ? ` (${confirmDelete.serial_number})` : ''}. Записът изчезва заедно с ПИН и ПУК.`
          : ''}
        destructive
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}

// ============================================================
// Форма за нов / редакция
// ============================================================
function CertificateForm({ cert, staff, onClose, onSaved, user }: {
  cert: Certificate | null
  staff: Array<{ id: string; full_name: string }>
  onClose: () => void
  onSaved: () => void
  user: { id?: string; full_name?: string } | null
}) {
  const [deviceNo, setDeviceNo] = useState(cert?.device_no ?? '')
  const [serial, setSerial] = useState(cert?.serial_number ?? '')
  const [ownerCn, setOwnerCn] = useState(cert?.owner_cn ?? '')
  const [certType, setCertType] = useState(cert?.cert_type ?? 'PersonalCertificate_QCQES')
  const [validFrom, setValidFrom] = useState(cert?.valid_from ?? '')
  const [validTo, setValidTo] = useState(cert?.valid_to ?? '')
  const [pin, setPin] = useState(cert?.pin ?? '')
  const [puk, setPuk] = useState(cert?.puk ?? '')
  const [assignee, setAssignee] = useState(cert?.assigned_staff_id ?? '')
  const [notes, setNotes] = useState(cert?.notes ?? '')
  const [saving, setSaving] = useState(false)

  const serialCheck = useMemo(() => normalizeSerial(serial), [serial])

  async function save() {
    if (serialCheck.error) { toast.error(serialCheck.error); return }
    if (validFrom && validTo && validTo < validFrom) {
      toast.error('„Валиден до" е преди „Валиден от"'); return
    }
    const patch: CertificatePatch = {
      device_no: deviceNo.trim() || null,
      serial_number: serialCheck.value || null,
      owner_cn: ownerCn.trim() || null,
      cert_type: certType.trim() || null,
      valid_from: validFrom || null,
      valid_to: validTo || null,
      pin: pin.trim() || null,
      puk: puk.trim() || null,
      assigned_staff_id: assignee || null,
      notes: notes.trim() || null,
    }
    setSaving(true)
    try {
      const audit = { userId: user?.id, userName: user?.full_name ?? '' }
      if (cert) {
        await updateCertificate(cert.id, patch, {
          ...audit,
          oldAssignee: cert.assigned_staff_id ? (staff.find(s => s.id === cert.assigned_staff_id)?.full_name ?? '') : '',
          newAssignee: assignee ? (staff.find(s => s.id === assignee)?.full_name ?? '') : '',
        })
      } else {
        await addCertificate(patch, audit)
      }
      toast.success(cert ? 'Записано' : 'Подписът е добавен')
      onSaved()
    } catch (e) {
      // Уникалният индекс пази от два реда с един и същ сериен номер.
      const msg = (e as Error).message ?? ''
      toast.error(msg.includes('duplicate') || msg.includes('unique')
        ? 'Вече има подпис с този сериен номер'
        : msg || 'Грешка при запис')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{cert ? 'Редакция на подпис' : 'Нов подпис'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="cf-no" className="text-xs">Номер на подписа</Label>
            <Input id="cf-no" value={deviceNo} onChange={e => setDeviceNo(e.target.value)} placeholder="5" />
          </div>
          <div>
            <Label htmlFor="cf-assignee" className="text-xs">Зачислен на</Label>
            <select
              id="cf-assignee" value={assignee} onChange={e => setAssignee(e.target.value)}
              className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">— свободен —</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="cf-serial" className="text-xs">Сериен номер</Label>
            <Input
              id="cf-serial" value={serial} onChange={e => setSerial(e.target.value)}
              placeholder="3356773797385379401" className="font-mono"
            />
            {serialCheck.error && (
              <p className="text-xs text-rose-600 dark:text-rose-400 mt-1 flex items-start gap-1">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {serialCheck.error}
              </p>
            )}
            {!serialCheck.error && serialCheck.warning && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 flex items-start gap-1">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {serialCheck.warning}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="cf-from" className="text-xs">Валиден от</Label>
            <Input id="cf-from" type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cf-to" className="text-xs">Валиден до</Label>
            <Input id="cf-to" type="date" value={validTo} onChange={e => setValidTo(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="cf-pin" className="text-xs">ПИН</Label>
            <Input id="cf-pin" value={pin} onChange={e => setPin(e.target.value)} className="font-mono" />
          </div>
          <div>
            <Label htmlFor="cf-puk" className="text-xs">ПУК</Label>
            <Input id="cf-puk" value={puk} onChange={e => setPuk(e.target.value)} className="font-mono" />
          </div>

          <div>
            <Label htmlFor="cf-cn" className="text-xs">Автор (CN)</Label>
            <Input id="cf-cn" value={ownerCn} onChange={e => setOwnerCn(e.target.value)} placeholder="IME PREZIME FAMILIYA" />
          </div>
          <div>
            <Label htmlFor="cf-type" className="text-xs">Тип на сертификата</Label>
            <Input id="cf-type" value={certType} onChange={e => setCertType(e.target.value)} />
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="cf-notes" className="text-xs">Бележка</Label>
            <Input id="cf-notes" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отказ</Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            {cert ? 'Запази' : 'Добави'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
