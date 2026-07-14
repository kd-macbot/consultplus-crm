import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Plus, Search, RefreshCw, Loader2, Trash2, ArrowRight, AlertTriangle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '../lib/auth'
import {
  addOpportunity, updateOpportunity, softDeleteOpportunity,
  convertOpportunityToClient, lookupByEik, lookupEikByName,
} from '../lib/storage'
import { useOpportunities, useStaff, useInvalidateCrm } from '../lib/queries'
import { OPPORTUNITY_STAGES, OPPORTUNITY_SOURCES, type Opportunity } from '../lib/types'

const STAGE_VARIANT: Record<string, string> = {
  'Нов': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  'В контакт': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  'Изпратена оферта': 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  'Преговори': 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  'Печеливш': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  'Загубен': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

const EMPTY_FORM = {
  name: '',
  eik: '',
  vat_number: '',
  address: '',
  public_url: '',
  owner_name_legal: '',
  manager_name_legal: '',
  stage: 'Нов' as string,
  estimated_value: '',
  source: '',
  responsible: '',
  next_action: '',
  next_action_date: '',
  contact_person: '',
  contact_phone: '',
  contact_email: '',
  notes: '',
}

type FormState = typeof EMPTY_FORM

function formatMoney(v: number | null): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('bg-BG', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)
}

function isOverdue(date: string | null): boolean {
  if (!date) return false
  return date < new Date().toISOString().slice(0, 10)
}

export function OpportunitiesPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  // Възможностите и персоналът идват от споделения React Query кеш —
  // повторно отваряне на страницата е МИГНОВЕНО.
  const oppsQ = useOpportunities()
  const staffQ = useStaff()
  const { invalidateOpportunities } = useInvalidateCrm()
  const opps = useMemo(() => oppsQ.data ?? [], [oppsQ.data])
  const staffList = useMemo(() => staffQ.data ?? [], [staffQ.data])
  const loading = !oppsQ.data || !staffQ.data
  const [stageFilter, setStageFilter] = useState<string>('')
  const [search, setSearch] = useState('')

  // Modal state
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [eikLookupBusy, setEikLookupBusy] = useState(false)

  // Lost reason modal
  const [lostTarget, setLostTarget] = useState<Opportunity | null>(null)
  const [lostReason, setLostReason] = useState('')

  // Convert confirm
  const [convertTarget, setConvertTarget] = useState<Opportunity | null>(null)
  const [converting, setConverting] = useState(false)

  const canEdit = user?.role === 'admin' || user?.role === 'manager'

  // refresh: след мутация → invalidate (без full reload, RQ refetch-ва на тиха).
  function refresh() {
    invalidateOpportunities()
  }

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return opps.filter(o => {
      if (stageFilter && o.stage !== stageFilter) return false
      if (s) {
        const hay = [o.name, o.eik, o.responsible, o.contact_person, o.contact_email, o.contact_phone, o.notes]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(s)) return false
      }
      return true
    })
  }, [opps, stageFilter, search])

  const stageStats = useMemo(() => {
    const counts = new Map<string, { count: number; value: number }>()
    OPPORTUNITY_STAGES.forEach(s => counts.set(s, { count: 0, value: 0 }))
    opps.forEach(o => {
      const cur = counts.get(o.stage) ?? { count: 0, value: 0 }
      cur.count += 1
      cur.value += o.estimated_value ?? 0
      counts.set(o.stage, cur)
    })
    return counts
  }, [opps])

  function openNew() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  function openEdit(o: Opportunity) {
    setEditingId(o.id)
    setForm({
      name: o.name,
      eik: o.eik ?? '',
      vat_number: o.vat_number ?? '',
      address: o.address ?? '',
      public_url: o.public_url ?? '',
      owner_name_legal: o.owner_name_legal ?? '',
      manager_name_legal: o.manager_name_legal ?? '',
      stage: o.stage,
      estimated_value: o.estimated_value?.toString() ?? '',
      source: o.source ?? '',
      responsible: o.responsible ?? '',
      next_action: o.next_action ?? '',
      next_action_date: o.next_action_date ?? '',
      contact_person: o.contact_person ?? '',
      contact_phone: o.contact_phone ?? '',
      contact_email: o.contact_email ?? '',
      notes: o.notes ?? '',
    })
    setShowForm(true)
  }

  function setF<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  async function handleEikLookup() {
    const q = (form.eik || form.name).trim()
    if (!q) { toast.error('Въведете ЕИК или име'); return }
    setEikLookupBusy(true)
    try {
      const isEik = /^\d{9}(\d{4})?$/.test(q)
      const res = isEik ? await lookupByEik(q) : await lookupEikByName(q)
      if (!res.fields) { toast.error('Не са намерени данни в регистъра'); return }
      setForm(f => ({
        ...f,
        eik: res.fields?.eik ?? f.eik,
        vat_number: res.fields?.vat_number ?? f.vat_number,
        address: res.fields?.address ?? f.address,
        public_url: res.fields?.public_url ?? f.public_url,
        owner_name_legal: res.fields?.owner_name ?? f.owner_name_legal,
        manager_name_legal: res.fields?.manager_name ?? f.manager_name_legal,
        // ако name е празно, попълваме от caption
        name: f.name || res.caption?.split(',')[0]?.trim() || '',
      }))
      toast.success('Данните са попълнени от регистъра')
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при заявка')
    }
    setEikLookupBusy(false)
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error('Името е задължително'); return }
    setSaving(true)
    try {
      const payload: Partial<Opportunity> & { name: string } = {
        name: form.name.trim(),
        eik: form.eik.trim() || null,
        vat_number: form.vat_number.trim() || null,
        address: form.address.trim() || null,
        public_url: form.public_url.trim() || null,
        owner_name_legal: form.owner_name_legal.trim() || null,
        manager_name_legal: form.manager_name_legal.trim() || null,
        stage: form.stage,
        estimated_value: form.estimated_value ? parseFloat(form.estimated_value) : null,
        source: form.source || null,
        responsible: form.responsible || null,
        next_action: form.next_action.trim() || null,
        next_action_date: form.next_action_date || null,
        contact_person: form.contact_person.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        contact_email: form.contact_email.trim() || null,
        notes: form.notes.trim() || null,
      }
      if (editingId) {
        await updateOpportunity(editingId, payload)
        toast.success('Възможността е обновена')
      } else {
        await addOpportunity({ ...payload, created_by: user?.id })
        toast.success('Възможността е добавена')
      }
      setShowForm(false)
      refresh()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
    }
    setSaving(false)
  }

  async function handleStageChange(o: Opportunity, newStage: string) {
    if (newStage === 'Загубен') {
      setLostTarget(o)
      setLostReason(o.lost_reason ?? '')
      return
    }
    try {
      await updateOpportunity(o.id, { stage: newStage, lost_reason: newStage === 'Загубен' ? o.lost_reason : null })
      refresh()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка')
    }
  }

  async function handleConfirmLost() {
    if (!lostTarget) return
    if (!lostReason.trim()) { toast.error('Моля въведете причина'); return }
    try {
      await updateOpportunity(lostTarget.id, { stage: 'Загубен', lost_reason: lostReason.trim() })
      setLostTarget(null)
      setLostReason('')
      refresh()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка')
    }
  }

  async function handleConfirmConvert() {
    if (!convertTarget) return
    setConverting(true)
    try {
      const { clientId } = await convertOpportunityToClient(convertTarget, user?.id, user?.full_name)
      toast.success(`„${convertTarget.name}" е добавен към Клиенти`, {
        action: { label: 'Виж', onClick: () => navigate(`/clients?focus=${clientId}`) },
      })
      setConvertTarget(null)
      refresh()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при конвертиране')
    }
    setConverting(false)
  }

  async function handleDelete(o: Opportunity) {
    if (!confirm(`Изтрий „${o.name}"?`)) return
    try {
      await softDeleteOpportunity(o.id)
      toast.success('Изтрита')
      refresh()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка')
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
      <div className="px-3 py-2 md:px-5 md:py-3 flex items-center justify-between border-b border-border bg-card">
        <h1 className="text-base md:text-lg font-semibold text-foreground">Възможности</h1>
        {canEdit && (
          <Button size="sm" onClick={openNew}>
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Нова</span>
          </Button>
        )}
      </div>

      {/* Stage pipeline summary */}
      <div className="px-3 md:px-5 py-3 grid grid-cols-2 md:grid-cols-6 gap-2 bg-card border-b border-border">
        {OPPORTUNITY_STAGES.map(s => {
          const stat = stageStats.get(s) ?? { count: 0, value: 0 }
          const isActive = stageFilter === s
          return (
            <button
              key={s}
              onClick={() => setStageFilter(isActive ? '' : s)}
              className={`text-left rounded-lg p-2 border transition ${
                isActive ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-muted-foreground'
              }`}
            >
              <div className="text-[10px] uppercase text-muted-foreground font-semibold">{s}</div>
              <div className="text-sm font-bold text-foreground">{stat.count} {stat.count > 0 && <span className="font-normal text-xs text-muted-foreground">/ {formatMoney(stat.value)}</span>}</div>
            </button>
          )
        })}
      </div>

      {/* Search bar */}
      <div className="px-3 md:px-5 py-2 border-b border-border bg-card flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Търси по име, ЕИК, отговорник, бележки..."
            className="pl-8 h-8 text-sm"
          />
        </div>
        {(stageFilter || search) && (
          <Button size="sm" variant="ghost" onClick={() => { setStageFilter(''); setSearch('') }}>
            Изчисти филтри
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} от {opps.length}</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-6 text-muted-foreground">Зареждане...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            {opps.length === 0 ? 'Няма добавени възможности. Натисни „Нова".' : 'Няма съвпадения.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card z-10 shadow-sm">
              <tr className="text-left border-b border-border">
                <th className="px-3 py-2 font-semibold text-xs text-muted-foreground uppercase">Фирма</th>
                <th className="px-3 py-2 font-semibold text-xs text-muted-foreground uppercase">ЕИК</th>
                <th className="px-3 py-2 font-semibold text-xs text-muted-foreground uppercase">Етап</th>
                <th className="px-3 py-2 font-semibold text-xs text-muted-foreground uppercase text-right">Стойност</th>
                <th className="px-3 py-2 font-semibold text-xs text-muted-foreground uppercase">Отговорник</th>
                <th className="px-3 py-2 font-semibold text-xs text-muted-foreground uppercase">Следващо</th>
                <th className="px-3 py-2 font-semibold text-xs text-muted-foreground uppercase">Контакт</th>
                <th className="px-3 py-2 font-semibold text-xs text-muted-foreground uppercase w-32">Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(o => {
                const overdue = isOverdue(o.next_action_date) && o.stage !== 'Печеливш' && o.stage !== 'Загубен'
                const converted = !!o.converted_to_client_id
                return (
                  <tr key={o.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <button onClick={() => openEdit(o)} className="text-left hover:underline">
                        <div className="font-medium text-foreground">{o.name}</div>
                        {o.source && <div className="text-[10px] text-muted-foreground">{o.source}</div>}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{o.eik ?? '—'}</td>
                    <td className="px-3 py-2">
                      {canEdit && !converted ? (
                        <select
                          value={o.stage}
                          onChange={e => handleStageChange(o, e.target.value)}
                          className={`text-xs px-2 py-0.5 rounded-full border-0 font-semibold ${STAGE_VARIANT[o.stage] ?? 'bg-muted text-foreground'}`}
                        >
                          {OPPORTUNITY_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <Badge className={STAGE_VARIANT[o.stage] ?? ''}>{o.stage}</Badge>
                      )}
                      {o.stage === 'Загубен' && o.lost_reason && (
                        <div className="text-[10px] text-muted-foreground mt-1" title={o.lost_reason}>
                          {o.lost_reason.length > 30 ? o.lost_reason.slice(0, 30) + '…' : o.lost_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{formatMoney(o.estimated_value)}</td>
                    <td className="px-3 py-2 text-xs">{o.responsible ?? '—'}</td>
                    <td className="px-3 py-2">
                      {o.next_action_date ? (
                        <div className={`text-xs ${overdue ? 'text-red-600 font-semibold' : ''}`}>
                          {overdue && <AlertTriangle className="inline h-3 w-3 mr-1" />}
                          {o.next_action_date}
                          {o.next_action && <div className="text-[10px] text-muted-foreground truncate max-w-[160px]" title={o.next_action}>{o.next_action}</div>}
                        </div>
                      ) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {o.contact_person && <div>{o.contact_person}</div>}
                      {o.contact_phone && <div className="text-muted-foreground">{o.contact_phone}</div>}
                      {o.contact_email && <div className="text-muted-foreground">{o.contact_email}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        {!converted ? (
                          <button
                            onClick={() => setConvertTarget(o)}
                            disabled={!o.name || !canEdit}
                            title="Конвертирай в клиент"
                            className="p-1 rounded hover:bg-emerald-100 text-emerald-700 dark:hover:bg-emerald-900/40 dark:text-emerald-300 disabled:opacity-30"
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <span className="text-[10px] text-emerald-600 font-semibold">✓ Конв.</span>
                        )}
                        {canEdit && (
                          <button
                            onClick={() => handleDelete(o)}
                            title="Изтрий"
                            className="p-1 rounded hover:bg-red-100 text-red-600 dark:hover:bg-red-900/40 dark:text-red-300"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">{editingId ? 'Редактиране' : 'Нова възможност'}</h2>
              <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Фирма + ЕИК</label>
                <div className="grid grid-cols-[2fr,1fr,auto] gap-2">
                  <Input placeholder="Име на фирмата" value={form.name} onChange={e => setF('name', e.target.value)} />
                  <Input placeholder="ЕИК" value={form.eik} onChange={e => setF('eik', e.target.value)} className="font-mono" />
                  <Button variant="outline" onClick={handleEikLookup} disabled={eikLookupBusy} title="Извлечи от регистъра">
                    {eikLookupBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                {(form.vat_number || form.address) && (
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {form.vat_number && <>ДДС: {form.vat_number} · </>}
                    {form.address}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Етап</label>
                  <select value={form.stage} onChange={e => setF('stage', e.target.value)} className="w-full h-9 px-2 text-sm border border-border rounded-md bg-background">
                    {OPPORTUNITY_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Очаквана стойност (EUR/мес)</label>
                  <Input type="number" step="0.01" placeholder="0" value={form.estimated_value} onChange={e => setF('estimated_value', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Източник</label>
                  <select value={form.source} onChange={e => setF('source', e.target.value)} className="w-full h-9 px-2 text-sm border border-border rounded-md bg-background">
                    <option value="">—</option>
                    {OPPORTUNITY_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Отговорник</label>
                  <select value={form.responsible} onChange={e => setF('responsible', e.target.value)} className="w-full h-9 px-2 text-sm border border-border rounded-md bg-background">
                    <option value="">—</option>
                    {staffList.map(s => <option key={s.id} value={s.full_name}>{s.full_name}{s.department ? ` (${s.department})` : ''}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Следващо действие</label>
                <div className="grid grid-cols-[2fr,1fr] gap-2">
                  <Input placeholder="Какво да направя следващото..." value={form.next_action} onChange={e => setF('next_action', e.target.value)} />
                  <Input type="date" value={form.next_action_date} onChange={e => setF('next_action_date', e.target.value)} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Контакт за връзка</label>
                <div className="grid grid-cols-3 gap-2">
                  <Input placeholder="Лице" value={form.contact_person} onChange={e => setF('contact_person', e.target.value)} />
                  <Input placeholder="Телефон" value={form.contact_phone} onChange={e => setF('contact_phone', e.target.value)} />
                  <Input placeholder="Имейл" type="email" value={form.contact_email} onChange={e => setF('contact_email', e.target.value)} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Бележки</label>
                <textarea value={form.notes} onChange={e => setF('notes', e.target.value)} rows={3} className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
              <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>Отказ</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? 'Записване...' : 'Запази'}</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Lost reason modal */}
      {lostTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md shadow-xl">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="font-semibold">Защо е загубена „{lostTarget.name}"?</h2>
            </div>
            <div className="px-5 py-4">
              <textarea autoFocus value={lostReason} onChange={e => setLostReason(e.target.value)} rows={3} placeholder="Цена / Конкуренция / Не отговарят / Друго..." className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background" />
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
              <Button variant="outline" onClick={() => setLostTarget(null)}>Отказ</Button>
              <Button onClick={handleConfirmLost} disabled={!lostReason.trim()}>Запази</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Convert confirm */}
      {convertTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md shadow-xl">
            <div className="px-5 py-4 border-b border-border flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-emerald-600" />
              <h2 className="font-semibold">Конвертирай „{convertTarget.name}" в клиент?</h2>
            </div>
            <div className="px-5 py-4 text-sm space-y-2">
              <p>Ще се създаде нов клиент с пренесените данни:</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                <li>Име, ЕИК, ДДС, адрес</li>
                <li>Собственик / Управляващ от регистъра</li>
                <li>Контактен телефон / имейл (като контакт)</li>
                {convertTarget.responsible && <li>Отговорник: <strong>{convertTarget.responsible}</strong></li>}
                <li>Бележки</li>
              </ul>
              <p className="text-xs text-muted-foreground pt-2">Възможността ще се маркира като „Печеливш" и ще остане тук с препратка към клиента.</p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
              <Button variant="outline" onClick={() => setConvertTarget(null)} disabled={converting}>Отказ</Button>
              <Button onClick={handleConfirmConvert} disabled={converting}>{converting ? 'Конвертиране...' : 'Конвертирай'}</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
