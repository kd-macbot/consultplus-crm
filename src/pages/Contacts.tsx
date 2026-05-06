import { useState, useEffect, useMemo } from 'react'
import { getContactsWithClients, getClientNames, upsertContact, deleteContact } from '../lib/storage'
import type { ContactWithClient } from '../lib/types'
import { useAuth } from '../lib/auth'
import { Plus, Pencil, Trash2, Search, X, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/alert-dialog'

interface ClientOption { id: string; name: string }

const EMPTY_FORM = {
  client_id: '',
  owner_name: '',
  owner_email: '',
  owner_phone: '',
  manager_name: '',
  manager_email: '',
  company_email: '',
  eik: '',
  vat_number: '',
  address: '',
  website: '',
  notes: '',
}

type FormState = typeof EMPTY_FORM

export function ContactsPage() {
  const { user } = useAuth()
  const canEdit = user?.role === 'admin' || user?.role === 'manager'

  const [contacts, setContacts] = useState<ContactWithClient[]>([])
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<ContactWithClient | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [c, opts] = await Promise.all([getContactsWithClients(), getClientNames()])
      setContacts(c)
      setClientOptions(opts)
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при зареждане')
    }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return contacts
    const q = search.toLowerCase()
    return contacts.filter(c =>
      [c.client_name, c.owner_name, c.owner_email, c.owner_phone,
        c.manager_name, c.eik, c.address]
        .some(v => v?.toLowerCase().includes(q))
    )
  }, [contacts, search])

  // Clients that don't yet have a contact (for the selector in the add form)
  const availableClients = useMemo(() => {
    if (editingId) return clientOptions // editing existing — no restriction
    const taken = new Set(contacts.map(c => c.client_id))
    return clientOptions.filter(o => !taken.has(o.id))
  }, [clientOptions, contacts, editingId])

  function openAdd() {
    setEditingId(null)
    setForm({ ...EMPTY_FORM, client_id: availableClients[0]?.id ?? '' })
    setShowModal(true)
  }

  function openEdit(c: ContactWithClient) {
    setEditingId(c.id)
    setForm({
      client_id: c.client_id,
      owner_name: c.owner_name ?? '',
      owner_email: c.owner_email ?? '',
      owner_phone: c.owner_phone ?? '',
      manager_name: c.manager_name ?? '',
      manager_email: c.manager_email ?? '',
      company_email: c.company_email ?? '',
      eik: c.eik ?? '',
      vat_number: c.vat_number ?? '',
      address: c.address ?? '',
      website: c.website ?? '',
      notes: c.notes ?? '',
    })
    setShowModal(true)
  }

  function set(field: keyof FormState, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSave() {
    if (!form.client_id) { toast.error('Изберете клиент'); return }
    setSaving(true)
    try {
      await upsertContact({
        ...(editingId ? { id: editingId } : {}),
        client_id: form.client_id,
        owner_name: form.owner_name || null,
        owner_email: form.owner_email || null,
        owner_phone: form.owner_phone || null,
        manager_name: form.manager_name || null,
        manager_email: form.manager_email || null,
        company_email: form.company_email || null,
        eik: form.eik || null,
        vat_number: form.vat_number || null,
        address: form.address || null,
        website: form.website || null,
        notes: form.notes || null,
        created_by: user?.id ?? null,
      })
      toast.success(editingId ? 'Контактът е обновен' : 'Контактът е добавен')
      setShowModal(false)
      await load()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
    }
    setSaving(false)
  }

  async function handleDelete(c: ContactWithClient) {
    try {
      await deleteContact(c.id)
      toast.success(`Контактът за "${c.client_name}" е изтрит`)
      setConfirmDelete(null)
      await load()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка')
    }
  }

  if (loading) return (
    <div className="p-6 flex items-center gap-2 text-muted-foreground">
      <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      Зареждане...
    </div>
  )

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] md:h-screen">

      {/* Header */}
      <div className="px-3 py-2 md:px-5 md:py-3 flex items-center justify-between border-b border-border bg-card shrink-0">
        <h1 className="text-base md:text-lg font-semibold text-foreground">
          Контакти
          <span className="ml-2 text-sm font-normal text-muted-foreground">{filtered.length}</span>
        </h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Търси..."
              className="pl-8 h-8 w-44 text-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {canEdit && availableClients.length > 0 && (
            <Button size="sm" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Добави</span>
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <p className="text-sm">{search ? 'Няма резултати' : 'Няма добавени контакти'}</p>
            {canEdit && !search && availableClients.length > 0 && (
              <Button size="sm" variant="outline" onClick={openAdd}>
                <Plus className="h-3.5 w-3.5" /> Добави първи контакт
              </Button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Клиент</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Собственик</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider hidden md:table-cell">Телефон</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider hidden lg:table-cell">Управляващ</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider hidden xl:table-cell">ЕИК</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider hidden xl:table-cell">Адрес</th>
                {canEdit && <th className="px-4 py-2.5 w-20" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr
                  key={c.id}
                  className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${i % 2 === 0 ? '' : 'bg-muted/10'}`}
                >
                  <td className="px-4 py-2.5 font-medium text-foreground">
                    {c.client_name || <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {c.owner_name
                      ? <div>
                          <p className="font-medium leading-tight">{c.owner_name}</p>
                          {c.owner_email && <p className="text-xs text-muted-foreground">{c.owner_email}</p>}
                        </div>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell text-muted-foreground">
                    {c.owner_phone || '—'}
                  </td>
                  <td className="px-4 py-2.5 hidden lg:table-cell">
                    {c.manager_name
                      ? <div>
                          <p className="leading-tight">{c.manager_name}</p>
                          {c.manager_email && <p className="text-xs text-muted-foreground">{c.manager_email}</p>}
                        </div>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5 hidden xl:table-cell text-muted-foreground font-mono text-xs">
                    {c.eik || '—'}
                  </td>
                  <td className="px-4 py-2.5 hidden xl:table-cell text-muted-foreground max-w-[180px] truncate">
                    {c.address || '—'}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/60 hover:text-destructive"
                          onClick={() => setConfirmDelete(c)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">
                {editingId ? 'Редактиране на контакт' : 'Нов контакт'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-5">

              {/* Client selector */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Клиент</label>
                {editingId ? (
                  <p className="text-sm font-medium text-foreground">
                    {contacts.find(c => c.id === editingId)?.client_name ?? form.client_id}
                  </p>
                ) : (
                  <select
                    value={form.client_id}
                    onChange={e => set('client_id', e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">— Изберете клиент —</option>
                    {availableClients.map(o => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Owner */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Собственик</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Input placeholder="Пълно име" value={form.owner_name} onChange={e => set('owner_name', e.target.value)} />
                  <Input placeholder="Имейл" type="email" value={form.owner_email} onChange={e => set('owner_email', e.target.value)} />
                  <Input placeholder="Телефон" type="tel" value={form.owner_phone} onChange={e => set('owner_phone', e.target.value)} />
                </div>
              </div>

              {/* Manager */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Управляващ</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input placeholder="Пълно име" value={form.manager_name} onChange={e => set('manager_name', e.target.value)} />
                  <Input placeholder="Имейл" type="email" value={form.manager_email} onChange={e => set('manager_email', e.target.value)} />
                </div>
              </div>

              {/* Company data */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Фирмени данни</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input placeholder="Фирмен имейл" type="email" value={form.company_email} onChange={e => set('company_email', e.target.value)} />
                  <Input placeholder="ЕИК" value={form.eik} onChange={e => set('eik', e.target.value)} />
                  <Input placeholder="ДДС номер" value={form.vat_number} onChange={e => set('vat_number', e.target.value)} />
                  <Input placeholder="Уебсайт" type="url" value={form.website} onChange={e => set('website', e.target.value)} />
                  <Input placeholder="Адрес / Седалище" value={form.address} onChange={e => set('address', e.target.value)} className="sm:col-span-2" />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Бележки</label>
                <textarea
                  value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  placeholder="Свободен текст..."
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
              <Button variant="ghost" onClick={() => setShowModal(false)}>Отказ</Button>
              <Button onClick={handleSave} disabled={saving || !form.client_id}>
                {saving ? 'Запазване...' : 'Запази'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title={`Изтриване на контакт за "${confirmDelete?.client_name}"?`}
        description="Всички данни на контакта ще бъдат изтрити. Операцията е необратима."
        confirmLabel="Изтрий"
        destructive
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}
