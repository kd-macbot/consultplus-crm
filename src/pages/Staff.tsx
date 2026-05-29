import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { createStaffMember, updateStaffMember, setStaffActive, getAllProfiles, withRetry } from '../lib/storage'
import { useAuth, adminCreateUser } from '../lib/auth'
import type { Profile, Role } from '../lib/types'
import { Users, UserCheck, UserX, Pencil, Mail, Phone, Building2, Plus, KeyRound, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

interface StaffMember {
  id: string
  full_name: string
  position: string | null
  department: string | null
  email: string | null
  phone: string | null
  is_active: boolean
  created_at: string
}

const DEPARTMENTS = ['Счетоводство', 'ТРЗ', 'Тийм Лийд', 'Управление', 'Друго']

const DEPT_VARIANT: Record<string, 'info' | 'success' | 'warning' | 'muted'> = {
  'Счетоводство': 'info',
  'ТРЗ': 'success',
  'Тийм Лийд': 'warning',
  'Управление': 'warning',
  'Друго': 'muted',
}

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Администратор',
  manager: 'Мениджър',
  employee: 'Служител',
}

export function StaffPage() {
  const { user } = useAuth()
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<StaffMember | null>(null)
  const [filterDept, setFilterDept] = useState('all')
  const [accountFor, setAccountFor] = useState<StaffMember | null>(null)
  const [accountLoading, setAccountLoading] = useState(false)

  const isAdmin = user?.role === 'admin'

  useEffect(() => { loadStaff(); loadProfiles() }, [])

  async function loadStaff() {
    setLoading(true)
    try {
      // withRetry: при връщане към „заспал" таб първата заявка може да се
      // отмени (timeout заради опресняване на токена) — повтаряме вместо да
      // оставим празна страница, която иска ръчен рефреш.
      const data = await withRetry(async () => {
        const { data, error } = await supabase
          .from('crm_staff')
          .select('*')
          .order('full_name')
        if (error) throw error
        return data ?? []
      })
      setStaff(data)
    } catch (err) {
      console.error('loadStaff error:', err)
      toast.error('Грешка при зареждане на персонала. Опитайте отново.')
    } finally {
      setLoading(false)
    }
  }

  async function loadProfiles() {
    // RLS: само админ вижда чужди профили; за останалите се връща само техният.
    try { setProfiles(await withRetry(getAllProfiles)) } catch { /* без права */ }
  }

  // Връзка служител ↔ акаунт по имейл (case-insensitive).
  const profileByEmail = useMemo(
    () => new Map(profiles.map(p => [p.email.toLowerCase(), p])),
    [profiles],
  )
  const profileOf = (m: StaffMember): Profile | undefined =>
    m.email ? profileByEmail.get(m.email.toLowerCase()) : undefined

  async function createAccount(password: string, role: Role) {
    if (!accountFor?.email) return
    setAccountLoading(true)
    try {
      const { error } = await adminCreateUser(accountFor.email.trim(), password, accountFor.full_name, role)
      if (error) { toast.error(error); return }
      toast.success(`Акаунт за „${accountFor.full_name}" е създаден`)
      setAccountFor(null)
      await loadProfiles()
    } finally {
      setAccountLoading(false)
    }
  }

  async function saveStaff(member: Partial<StaffMember>) {
    const audit = { userId: user?.id, userName: user?.full_name ?? '' }
    try {
      if (editing) {
        await updateStaffMember(editing.id, member, { ...audit, staffName: editing.full_name })
        toast.success(`${editing.full_name} е обновен`)
      } else {
        await createStaffMember(member, audit)
        toast.success('Служителят е добавен')
      }
      setShowForm(false)
      setEditing(null)
      await loadStaff()
    } catch (err) {
      // Формата остава отворена, за да опита пак — без мълчаливо „заковаване".
      console.error('saveStaff error:', err)
      toast.error('Промяната не беше записана. Опитайте отново.')
    }
  }

  async function toggleActive(id: string, current: boolean) {
    const member = staff.find(s => s.id === id)
    try {
      await setStaffActive(id, !current, {
        userId: user?.id,
        userName: user?.full_name ?? '',
        staffName: member?.full_name,
      })
      await loadStaff()
    } catch (err) {
      console.error('toggleActive error:', err)
      toast.error('Промяната не беше записана. Опитайте отново.')
    }
  }

  const filtered = filterDept === 'all' ? staff : staff.filter(s => s.department === filterDept)
  const active = filtered.filter(s => s.is_active)
  const inactive = filtered.filter(s => !s.is_active)

  if (loading) return (
    <div className="p-6 flex items-center gap-2 text-muted-foreground">
      <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      Зареждане...
    </div>
  )

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl md:text-2xl font-bold text-foreground">Персонал</h1>
        <div className="flex items-center gap-2">
          <select
            value={filterDept}
            onChange={e => setFilterDept(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">Всички отдели</option>
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          {isAdmin && (
            <Button size="sm" onClick={() => { setEditing(null); setShowForm(true) }}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Нов служител</span>
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-primary/10">
              <Users className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Общо</p>
              <p className="text-xl font-bold text-primary">{staff.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-green-100">
              <UserCheck className="h-4 w-4 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Активни</p>
              <p className="text-xl font-bold text-green-600">{staff.filter(s => s.is_active).length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-amber-100">
              <Building2 className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Отдели</p>
              <p className="text-xl font-bold text-amber-600">{new Set(staff.map(s => s.department).filter(Boolean)).size}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active staff grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {active.map(member => (
          <StaffCard key={member.id} member={member} isAdmin={isAdmin}
            profile={profileOf(member)}
            onEdit={() => { setEditing(member); setShowForm(true) }}
            onToggle={() => toggleActive(member.id, member.is_active)}
            onCreateAccount={() => setAccountFor(member)}
          />
        ))}
      </div>

      {inactive.length > 0 && (
        <>
          <p className="text-sm font-medium text-muted-foreground">Неактивни ({inactive.length})</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-60">
            {inactive.map(member => (
              <StaffCard key={member.id} member={member} isAdmin={isAdmin}
                profile={profileOf(member)}
                onEdit={() => { setEditing(member); setShowForm(true) }}
                onToggle={() => toggleActive(member.id, member.is_active)}
                onCreateAccount={() => setAccountFor(member)}
              />
            ))}
          </div>
        </>
      )}

      <StaffForm
        open={showForm}
        member={editing}
        onSave={saveStaff}
        onClose={() => { setShowForm(false); setEditing(null) }}
      />

      <CreateAccountForm
        member={accountFor}
        loading={accountLoading}
        onSubmit={createAccount}
        onClose={() => setAccountFor(null)}
      />
    </div>
  )
}

function StaffCard({ member, isAdmin, profile, onEdit, onToggle, onCreateAccount }: {
  member: StaffMember; isAdmin: boolean; profile?: Profile
  onEdit: () => void; onToggle: () => void; onCreateAccount: () => void
}) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
              {member.full_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-sm leading-tight">{member.full_name}</p>
              {member.position && <p className="text-xs text-muted-foreground leading-tight mt-0.5">{member.position}</p>}
            </div>
          </div>
          {member.department && (
            <Badge variant={DEPT_VARIANT[member.department] ?? 'muted'} className="text-[10px] shrink-0">
              {member.department}
            </Badge>
          )}
        </div>

        <div className="space-y-1 mb-3">
          {member.email && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Mail className="h-3 w-3 shrink-0" />
              <span className="truncate">{member.email}</span>
            </div>
          )}
          {member.phone && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Phone className="h-3 w-3 shrink-0" />
              <span>{member.phone}</span>
            </div>
          )}
          {profile && (
            <div className="flex items-center gap-1.5 text-xs">
              <ShieldCheck className="h-3 w-3 shrink-0 text-emerald-600" />
              <span className="text-muted-foreground">Акаунт:</span>
              <span className="font-medium">{ROLE_LABELS[profile.role]}</span>
              {!profile.is_active && <span className="text-destructive">(деактивиран)</span>}
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="flex flex-wrap gap-2 pt-3 border-t border-border">
            <Button variant="ghost" size="sm" onClick={onEdit} className="h-7 text-xs gap-1 px-2">
              <Pencil className="h-3 w-3" /> Редактирай
            </Button>
            <Button variant="ghost" size="sm" onClick={onToggle} className="h-7 text-xs gap-1 px-2 text-muted-foreground">
              {member.is_active
                ? <><UserX className="h-3 w-3" /> Деактивирай</>
                : <><UserCheck className="h-3 w-3" /> Активирай</>
              }
            </Button>
            {!profile && member.email && (
              <Button variant="ghost" size="sm" onClick={onCreateAccount} className="h-7 text-xs gap-1 px-2 text-primary">
                <KeyRound className="h-3 w-3" /> Създай акаунт
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StaffForm({ open, member, onSave, onClose }: {
  open: boolean; member: StaffMember | null
  onSave: (m: Partial<StaffMember>) => void; onClose: () => void
}) {
  const [name, setName] = useState(member?.full_name ?? '')
  const [position, setPosition] = useState(member?.position ?? '')
  const [department, setDepartment] = useState(member?.department ?? '')
  const [email, setEmail] = useState(member?.email ?? '')
  const [phone, setPhone] = useState(member?.phone ?? '')

  useEffect(() => {
    if (open) {
      setName(member?.full_name ?? '')
      setPosition(member?.position ?? '')
      setDepartment(member?.department ?? '')
      setEmail(member?.email ?? '')
      setPhone(member?.phone ?? '')
    }
  }, [open, member])

  function handleSave() {
    if (!name.trim()) return
    onSave({
      full_name: name.trim(),
      position: position.trim() || null,
      department: department || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{member ? 'Редактирай служител' : 'Нов служител'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sf-name">Пълно име *</Label>
            <Input id="sf-name" value={name} onChange={e => setName(e.target.value)}
              placeholder="Иван Иванов" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf-position">Позиция</Label>
            <Input id="sf-position" value={position} onChange={e => setPosition(e.target.value)}
              placeholder="Счетоводител, ТРЗ специалист..." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf-dept">Отдел</Label>
            <select
              id="sf-dept"
              value={department}
              onChange={e => setDepartment(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">— Без отдел —</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sf-email">Имейл</Label>
              <Input id="sf-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="email@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sf-phone">Телефон</Label>
              <Input id="sf-phone" value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="+359..." />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отказ</Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            {member ? 'Запази' : 'Добави'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateAccountForm({ member, loading, onSubmit, onClose }: {
  member: StaffMember | null; loading: boolean
  onSubmit: (password: string, role: Role) => void; onClose: () => void
}) {
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('employee')

  useEffect(() => {
    if (member) { setPassword(''); setRole('employee') }
  }, [member])

  return (
    <Dialog open={!!member} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Създай акаунт</DialogTitle>
        </DialogHeader>

        {member && (
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/40 p-3 text-sm space-y-0.5">
              <p><span className="text-muted-foreground">Служител:</span> <span className="font-medium">{member.full_name}</span></p>
              <p><span className="text-muted-foreground">Имейл (логин):</span> <span className="font-medium">{member.email}</span></p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ca-pass">Временна парола *</Label>
              <Input id="ca-pass" type="password" value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="поне 6 символа" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ca-role">Роля *</Label>
              <select
                id="ca-role"
                value={role}
                onChange={e => setRole(e.target.value as Role)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {(Object.keys(ROLE_LABELS) as Role[]).map(r => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              Потребителят влиза с имейла си и тази парола (препоръчай да я смени след първото влизане). Имейл за потвърждение не се праща.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отказ</Button>
          <Button onClick={() => onSubmit(password, role)} disabled={loading || password.length < 6}>
            {loading ? 'Създаване...' : 'Създай акаунт'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
