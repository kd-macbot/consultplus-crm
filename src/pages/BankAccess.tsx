import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Navigate } from 'react-router-dom'
import {
  Landmark, Search, Plus, Trash2, X, Eye, EyeOff, Copy, ExternalLink, ShieldCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '../lib/auth'
import {
  useClients, useColumns, useCellValues, useStaff, useBankAccess, useInvalidateCrm,
} from '../lib/queries'
import { upsertBankAccess, deleteBankAccess } from '../lib/storage'
import {
  BANK_ACCESS_TYPES, BANK_ACCESS_TYPE_LABELS, BANKS,
  type BankAccess, type BankAccessType,
} from '../lib/types'
import { namesMatch } from '../lib/utils'

// Клетка за парола — masked по подразбиране, с бутон „покажи" + copy.
function PasswordCell({ value }: { value: string | null }) {
  const [shown, setShown] = useState(false)
  if (!value) return <span className="text-muted-foreground/40">—</span>
  return (
    <div className="flex items-center gap-1">
      <span className="font-mono text-xs">{shown ? value : '••••••••'}</span>
      <button
        type="button"
        onClick={() => setShown(s => !s)}
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

// Копируем текст (потребител).
function CopyText({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground/40">—</span>
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs">{value}</span>
      <button
        type="button"
        onClick={() => { navigator.clipboard?.writeText(value); toast.success('Копирано') }}
        className="text-muted-foreground hover:text-foreground shrink-0"
        title="Копирай"
      >
        <Copy className="h-3 w-3" />
      </button>
    </div>
  )
}

export function BankAccessPage() {
  const { user } = useAuth()
  const clientsQ = useClients()
  const columnsQ = useColumns()
  const cellsQ = useCellValues()
  const staffQ = useStaff()
  const bankQ = useBankAccess()
  const { invalidateBankAccess } = useInvalidateCrm()

  const clients = useMemo(() => clientsQ.data ?? [], [clientsQ.data])
  const columns = useMemo(() => columnsQ.data ?? [], [columnsQ.data])
  const cells = useMemo(() => cellsQ.data ?? [], [cellsQ.data])
  const bankRows = useMemo(() => bankQ.data ?? [], [bankQ.data])

  // ============================================================
  // Достъп по отдел:
  //   Виждат   → отдел Тийм Лийд, Управление, или admin
  //   Редактират → admin или отдел Управление
  // Отделите се проверяват и в основния, и в допълнителните.
  // ============================================================
  const myStaff = useMemo(
    () => (staffQ.data ?? []).find(s => namesMatch(s.full_name, user?.full_name)),
    [staffQ.data, user?.full_name],
  )
  const inDept = useCallback((dept: string) => {
    if (!myStaff) return false
    return myStaff.department === dept || (myStaff.additional_departments ?? []).includes(dept)
  }, [myStaff])
  const isAdmin = user?.role === 'admin'
  const canView = isAdmin || inDept('Тийм Лийд') || inDept('Управление')
  const canEdit = isAdmin || inDept('Управление')

  // Име на фирмата (първата text колона).
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

  const [search, setSearch] = useState('')
  const [bankFilter, setBankFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<'' | BankAccessType>('')
  const [addOpen, setAddOpen] = useState(false)
  const [editFor, setEditFor] = useState<BankAccess | null>(null)

  const configByClient = useMemo(() => {
    const m = new Map<string, BankAccess>()
    bankRows.forEach(r => m.set(r.client_id, r))
    return m
  }, [bankRows])

  const rows = useMemo(() => {
    let all = bankRows.map(r => ({ ...r, name: nameByClient.get(r.client_id) ?? '—' }))
    const q = search.trim().toLowerCase()
    if (q) all = all.filter(r => r.name.toLowerCase().includes(q))
    if (bankFilter) all = all.filter(r => (r.bank ?? '') === bankFilter)
    if (typeFilter) all = all.filter(r => r.access_type === typeFilter)
    return all.sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  }, [bankRows, nameByClient, search, bankFilter, typeFilter])

  // Банките, реално ползвани (за филтъра).
  const usedBanks = useMemo(
    () => [...new Set(bankRows.map(r => r.bank).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'bg')),
    [bankRows],
  )

  const ready = !!clientsQ.data && !!columnsQ.data && !!cellsQ.data && !!staffQ.data && !!bankQ.data

  const removeClient = useCallback(async (clientId: string, name: string) => {
    if (!confirm(`Да премахна „${name}" от банков достъп?\n\nЩе се изтрият всички данни за достъпа (парола и т.н.).`)) return
    try {
      await deleteBankAccess(clientId)
      await invalidateBankAccess()
      toast.success('Премахнато')
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка')
    }
  }, [invalidateBankAccess])

  if (ready && !canView) return <Navigate to="/" replace />

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
            <Landmark className="h-5 w-5 text-muted-foreground" />
            <div>
              <h1 className="text-base md:text-lg font-semibold text-foreground">Банков достъп</h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Достъп до онлайн банкирането на клиентите. Видимо само за логнати потребители.
              </p>
            </div>
          </div>
          {canEdit && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Добави клиент</span>
            </Button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Търси фирма..."
              className="w-full md:w-64 pl-8 pr-3 py-1.5 text-xs border border-border rounded bg-background focus:border-primary focus:outline-none"
            />
          </div>
          <select value={bankFilter} onChange={e => setBankFilter(e.target.value)}
            className="h-8 px-2 text-xs border border-border rounded bg-background focus:border-primary focus:outline-none">
            <option value="">Всички банки</option>
            {usedBanks.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as '' | BankAccessType)}
            className="h-8 px-2 text-xs border border-border rounded bg-background focus:border-primary focus:outline-none">
            <option value="">Всеки достъп</option>
            {BANK_ACCESS_TYPES.map(t => <option key={t} value={t}>{BANK_ACCESS_TYPE_LABELS[t]}</option>)}
          </select>
          <span className="text-xs text-muted-foreground ml-auto">
            {rows.length} {rows.length === 1 ? 'фирма' : 'фирми'}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10 bg-navy text-white">
            <tr>
              <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider min-w-[180px] sticky left-0 z-20 bg-navy border-r border-navy-light">Фирма</th>
              <th className="text-left px-2 py-2 font-semibold uppercase tracking-wider min-w-[110px]">Банка</th>
              <th className="text-left px-2 py-2 font-semibold uppercase tracking-wider min-w-[120px]">URL</th>
              <th className="text-left px-2 py-2 font-semibold uppercase tracking-wider min-w-[120px]">Потребител</th>
              <th className="text-left px-2 py-2 font-semibold uppercase tracking-wider min-w-[130px]">Парола</th>
              <th className="text-center px-2 py-2 font-semibold uppercase tracking-wider min-w-[80px]">Достъп</th>
              <th className="text-center px-2 py-2 font-semibold uppercase tracking-wider">2FA</th>
              <th className="text-center px-2 py-2 font-semibold uppercase tracking-wider">Плащаме</th>
              <th className="text-left px-2 py-2 font-semibold uppercase tracking-wider min-w-[140px]">Забележка</th>
              {canEdit && <th className="w-8"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 10 : 9} className="text-center py-12 text-muted-foreground">
                  {search || bankFilter || typeFilter ? 'Няма намерени фирми.' : 'Няма добавени фирми. Натисни „Добави клиент".'}
                </td>
              </tr>
            ) : rows.map((r, i) => {
              const evenBg = i % 2 === 0 ? 'bg-card' : 'bg-muted/20'
              return (
                <tr key={r.client_id} className={`border-b border-border ${evenBg} hover:bg-accent/30`}>
                  <td className={`px-3 py-1.5 font-medium sticky left-0 z-10 ${evenBg} border-r border-border whitespace-nowrap ${canEdit ? 'cursor-pointer hover:underline' : ''}`}
                    onClick={() => canEdit && setEditFor(configByClient.get(r.client_id) ?? null)}>
                    {r.name}
                  </td>
                  <td className="px-2 py-1.5">{r.bank ?? <span className="text-muted-foreground/40">—</span>}</td>
                  <td className="px-2 py-1.5">
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={e => e.stopPropagation()}>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate max-w-[140px]">{r.url.replace(/^https?:\/\//, '')}</span>
                      </a>
                    ) : <span className="text-muted-foreground/40">—</span>}
                  </td>
                  <td className="px-2 py-1.5"><CopyText value={r.username} /></td>
                  <td className="px-2 py-1.5"><PasswordCell value={r.password} /></td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium ${
                      r.access_type === 'individual'
                        ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                        : 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
                    }`}>
                      {BANK_ACCESS_TYPE_LABELS[r.access_type as BankAccessType] ?? r.access_type}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {r.has_2fa ? <ShieldCheck className="h-4 w-4 text-emerald-600 inline" /> : <span className="text-muted-foreground/40">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {r.we_pay ? <span className="text-emerald-600 font-semibold">✓</span> : <span className="text-muted-foreground/40">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">{r.notes ?? <span className="text-muted-foreground/40">—</span>}</td>
                  {canEdit && (
                    <td className="px-1 py-1.5">
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive/60 hover:text-destructive" onClick={() => removeClient(r.client_id, r.name)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {addOpen && (
        <BankAccessModal
          clients={clients}
          nameByClient={nameByClient}
          existingConfigs={configByClient}
          onClose={() => setAddOpen(false)}
          onSaved={async () => { await invalidateBankAccess(); setAddOpen(false) }}
          userId={user?.id}
        />
      )}
      {editFor && (
        <BankAccessModal
          clients={clients}
          nameByClient={nameByClient}
          existingConfigs={configByClient}
          editExisting={editFor}
          onClose={() => setEditFor(null)}
          onSaved={async () => { await invalidateBankAccess(); setEditFor(null) }}
          userId={user?.id}
        />
      )}
    </div>
  )
}

// ============================================================
// Modal: Добави / редактирай банков достъп
// ============================================================
function BankAccessModal({
  clients, nameByClient, existingConfigs, editExisting, onClose, onSaved, userId,
}: {
  clients: { id: string }[]
  nameByClient: Map<string, string>
  existingConfigs: Map<string, BankAccess>
  editExisting?: BankAccess
  onClose: () => void
  onSaved: () => Promise<void>
  userId?: string
}) {
  const [clientId, setClientId] = useState<string | null>(editExisting?.client_id ?? null)
  const [clientSearch, setClientSearch] = useState('')
  const [bank, setBank] = useState(editExisting?.bank ?? '')
  const [url, setUrl] = useState(editExisting?.url ?? '')
  const [username, setUsername] = useState(editExisting?.username ?? '')
  const [password, setPassword] = useState(editExisting?.password ?? '')
  const [accessType, setAccessType] = useState<BankAccessType>((editExisting?.access_type as BankAccessType) ?? 'shared')
  const [has2fa, setHas2fa] = useState(editExisting?.has_2fa ?? false)
  const [wePay, setWePay] = useState(editExisting?.we_pay ?? false)
  const [notes, setNotes] = useState(editExisting?.notes ?? '')
  const [showPass, setShowPass] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const availableClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase()
    return clients
      .map(c => ({ id: c.id, name: nameByClient.get(c.id) ?? '—' }))
      .filter(c => !existingConfigs.has(c.id))
      .filter(c => q ? c.name.toLowerCase().includes(q) : true)
      .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
      .slice(0, 50)
  }, [clients, nameByClient, existingConfigs, clientSearch])

  const canSave = clientId && !saving

  async function save() {
    if (!clientId) return
    setSaving(true)
    try {
      await upsertBankAccess(clientId, {
        bank: bank || null,
        url: url || null,
        username: username || null,
        password: password || null,
        access_type: accessType,
        has_2fa: has2fa,
        we_pay: wePay,
        notes: notes || null,
      }, userId)
      toast.success(editExisting ? 'Обновено' : 'Добавено')
      await onSaved()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-xl w-full max-w-md max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-foreground">{editExisting ? 'Редактирай достъп' : 'Добави клиент'}</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-3">
          {/* Client picker (само при добавяне) */}
          {!editExisting && (
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">Фирма</label>
              {clientId ? (
                <div className="flex items-center justify-between px-3 py-2 border border-border rounded-md bg-muted/30">
                  <span className="text-sm font-medium">{nameByClient.get(clientId)}</span>
                  <Button variant="ghost" size="sm" onClick={() => setClientId(null)}>Смени</Button>
                </div>
              ) : (
                <>
                  <input
                    type="text" value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                    placeholder="Търси фирма..." autoFocus
                    className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none"
                  />
                  <div className="mt-2 max-h-40 overflow-auto border border-border rounded-md">
                    {availableClients.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">Няма налични клиенти</p>
                    ) : availableClients.map(c => (
                      <button key={c.id} onClick={() => { setClientId(c.id); setClientSearch('') }}
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent/50 border-b border-border last:border-0">
                        {c.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {editExisting && (
            <div className="px-3 py-2 border border-border rounded-md bg-muted/30 text-sm font-medium">
              {nameByClient.get(editExisting.client_id)}
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Банка</label>
            <select value={bank} onChange={e => setBank(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none">
              <option value="">— избери —</option>
              {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
              {bank && !BANKS.includes(bank as typeof BANKS[number]) && <option value={bank}>{bank} (стара)</option>}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1">URL за вход</label>
            <input type="text" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..."
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">Потребител</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none" />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">Парола</label>
              <div className="relative">
                <input type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  className="w-full px-3 py-2 pr-8 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none" />
                <button type="button" onClick={() => setShowPass(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1.5">Тип достъп</label>
            <div className="flex gap-1.5">
              {BANK_ACCESS_TYPES.map(t => (
                <button key={t} type="button" onClick={() => setAccessType(t)}
                  className={`px-3 py-1 text-xs rounded border transition-all ${
                    accessType === t ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border text-muted-foreground hover:bg-muted/30'
                  }`}>
                  {BANK_ACCESS_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={has2fa} onChange={e => setHas2fa(e.target.checked)} className="h-3.5 w-3.5" />
              Има 2FA / автентикация
            </label>
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={wePay} onChange={e => setWePay(e.target.checked)} className="h-3.5 w-3.5" />
              Плащаме от тях
            </label>
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Забележка</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="напр. само гледаме"
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none" />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Отказ</Button>
          <Button onClick={save} disabled={!canSave}>{saving ? 'Записване...' : (editExisting ? 'Запиши' : 'Добави')}</Button>
        </div>
      </div>
    </div>
  )
}
