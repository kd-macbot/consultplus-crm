import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { createStaffMember, updateStaffMember, setStaffActive, getAllProfiles, withRetry } from '../lib/storage'
import { useAuth, adminCreateUser, adminResetPassword } from '../lib/auth'
import { generatePassword, isAcceptablePassword } from '../lib/password'
import type { Profile, Role } from '../lib/types'
import { Users, UserCheck, UserX, Pencil, Mail, Phone, Building2, Plus, KeyRound, ShieldCheck, CalendarDays, RotateCcw, Copy, Check, Wand2 } from 'lucide-react'
import { calcTenure, formatDate } from '../lib/utils'
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
  additional_departments: string[] | null
  email: string | null
  phone: string | null
  hire_date: string | null
  is_active: boolean
  /** false = извън Форма 76 и Справка отпуска (виж мигр. 060). */
  in_trz_reports: boolean | null
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
  const [resetFor, setResetFor] = useState<StaffMember | null>(null)
  const [resetLoading, setResetLoading] = useState(false)
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
      const { error, adopted } = await adminCreateUser(accountFor.email.trim(), password, accountFor.full_name, role)
      if (error) { toast.error(error); return }
      toast.success(adopted
        // Колегата вече беше влизал с Microsoft и е чакал профил.
        ? `„${accountFor.full_name}" получи достъп — акаунтът от Microsoft е свързан`
        : `Акаунт за „${accountFor.full_name}" е създаден`)
      setAccountFor(null)
      await loadProfiles()
    } finally {
      setAccountLoading(false)
    }
  }

  // Нулиране на парола. Връща успех/грешка на диалога, за да може той
  // да ОСТАВИ паролата на екрана — админът трябва да я каже на колегата,
  // а повече никъде няма да се види.
  async function resetPassword(password: string): Promise<boolean> {
    if (!resetFor?.email) return false
    setResetLoading(true)
    try {
      const { error } = await adminResetPassword(resetFor.email.trim(), password)
      if (error) { toast.error(error); return false }
      toast.success(`Паролата на „${resetFor.full_name}" е сменена`)
      return true
    } finally {
      setResetLoading(false)
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
            onResetPassword={() => setResetFor(member)}
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
                onResetPassword={() => setResetFor(member)}
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

      <ResetPasswordForm
        member={resetFor}
        loading={resetLoading}
        onSubmit={resetPassword}
        onClose={() => setResetFor(null)}
      />
    </div>
  )
}

function StaffCard({ member, isAdmin, profile, onEdit, onToggle, onCreateAccount, onResetPassword }: {
  member: StaffMember; isAdmin: boolean; profile?: Profile
  onEdit: () => void; onToggle: () => void; onCreateAccount: () => void
  onResetPassword: () => void
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
          <div className="flex flex-col items-end gap-1 shrink-0">
            {member.department && (
              <Badge variant={DEPT_VARIANT[member.department] ?? 'muted'} className="text-[10px]">
                {member.department}
              </Badge>
            )}
            {(member.additional_departments ?? []).map(d => (
              <Badge key={d} variant="muted" className="text-[10px] opacity-70">
                +{d}
              </Badge>
            ))}
          </div>
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
          {member.hire_date && (() => {
            const t = calcTenure(member.hire_date)
            return (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title={`Назначен на ${formatDate(member.hire_date)}`}>
                <CalendarDays className="h-3 w-3 shrink-0" />
                <span>Стаж: <span className="font-medium text-foreground">{t?.label ?? '—'}</span></span>
              </div>
            )
          })()}
          {member.in_trz_reports === false && (
            <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400"
              title="Отсъствията се виждат в Календара, но не влизат във Форма 76, Справка отпуска и месечния експорт">
              <CalendarDays className="h-3 w-3 shrink-0" />
              <span>Извън ТРЗ справките</span>
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
            {/* Нулиране — само когато акаунт ВЕЧЕ има. Двата бутона са
                взаимно изключващи се: или се създава, или се нулира. */}
            {profile && member.email && (
              <Button variant="ghost" size="sm" onClick={onResetPassword} className="h-7 text-xs gap-1 px-2 text-amber-700 dark:text-amber-400">
                <RotateCcw className="h-3 w-3" /> Нулирай парола
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
  const [additionalDepts, setAdditionalDepts] = useState<string[]>(member?.additional_departments ?? [])
  const [email, setEmail] = useState(member?.email ?? '')
  const [phone, setPhone] = useState(member?.phone ?? '')
  const [hireDate, setHireDate] = useState(member?.hire_date ?? '')
  const [inTrz, setInTrz] = useState(member?.in_trz_reports !== false)

  useEffect(() => {
    if (open) {
      setName(member?.full_name ?? '')
      setPosition(member?.position ?? '')
      setDepartment(member?.department ?? '')
      setAdditionalDepts(member?.additional_departments ?? [])
      setEmail(member?.email ?? '')
      setPhone(member?.phone ?? '')
      setHireDate(member?.hire_date ?? '')
      setInTrz(member?.in_trz_reports !== false)
    }
  }, [open, member])

  function toggleAdditional(d: string) {
    setAdditionalDepts(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }

  function handleSave() {
    if (!name.trim()) return
    onSave({
      full_name: name.trim(),
      position: position.trim() || null,
      department: department || null,
      // Допълнителните отдели не включват основния (без дублиране).
      additional_departments: additionalDepts.filter(d => d !== department),
      email: email.trim() || null,
      phone: phone.trim() || null,
      hire_date: hireDate || null,
      in_trz_reports: inTrz,
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
          <div className="space-y-1.5">
            <Label>Допълнителни отдели</Label>
            <p className="text-[11px] text-muted-foreground -mt-0.5">
              Служителят се появява и в dropdown-ите на тези отдели (напр. тийм лийд като „Счетоводител").
            </p>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {DEPARTMENTS.filter(d => d !== department).map(d => {
                const active = additionalDepts.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleAdditional(d)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-input hover:border-primary/50'
                    }`}
                  >
                    {d}
                  </button>
                )
              })}
            </div>
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
          <div className="space-y-1.5">
            <Label htmlFor="sf-hire-date">Дата на назначаване</Label>
            <Input id="sf-hire-date" type="date" value={hireDate} onChange={e => setHireDate(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox" checked={inTrz}
                onChange={e => setInTrz(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="text-sm text-foreground">Влиза в ТРЗ справките</span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Форма 76, Справка отпуска и месечният експорт на Календара.
                  Изключи за управител: отсъствията му се виждат в Календара,
                  за да знаят колегите, но не се отчитат никъде.
                </span>
              </span>
            </label>
            <p className="text-[11px] text-muted-foreground">
              Ще се ползва за изчисление на стаж и придобивки.
            </p>
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

// ============================================================
// Нулиране на парола.
//
// КЛЮЧОВОТО: след успех паролата ОСТАВА на екрана, с бутон за копиране.
// Админът трябва да я каже на колегата, а никъде другаде няма да се
// види — нито в дневника, нито в базата. Диалогът не се затваря сам.
// ============================================================
function ResetPasswordForm({ member, loading, onSubmit, onClose }: {
  member: StaffMember | null; loading: boolean
  onSubmit: (password: string) => Promise<boolean>; onClose: () => void
}) {
  const [password, setPassword] = useState('')
  const [done, setDone] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (member) { setPassword(generatePassword()); setDone(false); setCopied(false) }
  }, [member])

  async function copy() {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Копирането не стана — маркирай я и копирай на ръка')
    }
  }

  return (
    <Dialog open={!!member} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{done ? 'Паролата е сменена' : 'Нулирай парола'}</DialogTitle>
        </DialogHeader>

        {member && (
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/40 p-3 text-sm space-y-0.5">
              <p><span className="text-muted-foreground">Служител:</span> <span className="font-medium">{member.full_name}</span></p>
              <p><span className="text-muted-foreground">Имейл (логин):</span> <span className="font-medium">{member.email}</span></p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rp-pass">Нова парола *</Label>
              <div className="flex gap-2">
                {/* Паролата е ВИДИМА, не скрита с точки — целта е да се
                    прочете и предаде, не да се пази от рамото. */}
                <Input
                  id="rp-pass" type="text" value={password}
                  onChange={e => { setPassword(e.target.value); setDone(false) }}
                  readOnly={done}
                  className="font-mono"
                  autoFocus
                />
                <Button type="button" variant="outline" size="icon" onClick={copy} title="Копирай">
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </Button>
                {!done && (
                  <Button type="button" variant="outline" size="icon"
                    onClick={() => setPassword(generatePassword())} title="Генерирай нова">
                    <Wand2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            {done ? (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20 p-3 text-sm text-emerald-900 dark:text-emerald-200">
                <p className="font-medium">Запиши си паролата СЕГА.</p>
                <p className="mt-1 text-[13px]">
                  Няма да се види повече — не се пази нито в базата, нито в дневника.
                  Предай я на {member.full_name.split(' ')[0]} и ѝ кажи да я смени след влизане.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Генерираната парола е без знаци, които се бъркат при четене
                (нула и О, единица и малко л). В Дневника влиза кой на кого е
                нулирал — самата парола НЕ се записва никъде.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{done ? 'Затвори' : 'Отказ'}</Button>
          {!done && (
            <Button
              onClick={async () => { if (await onSubmit(password)) setDone(true) }}
              disabled={loading || !isAcceptablePassword(password)}
            >
              {loading ? 'Нулиране...' : 'Нулирай'}
            </Button>
          )}
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
  const [copied, setCopied] = useState(false)

  // Паролата се генерира ПРЕДВАРИТЕЛНО: при вход с Microsoft никой няма да
  // я ползва, но акаунтът трябва да съществува, за да има към какво да се
  // закачи самоличността от 365. Остава като резервен вход.
  useEffect(() => {
    if (member) { setPassword(generatePassword()); setRole('employee'); setCopied(false) }
  }, [member])

  async function copy() {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Копирането не стана — маркирай я и копирай на ръка')
    }
  }

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
              <div className="flex gap-2">
                {/* Видима, не с точки — трябва да се прочете и предаде. */}
                <Input id="ca-pass" type="text" value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="поне 6 символа" className="font-mono" autoFocus />
                <Button type="button" variant="outline" size="icon" onClick={copy} title="Копирай">
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </Button>
                <Button type="button" variant="outline" size="icon"
                  onClick={() => setPassword(generatePassword())} title="Генерирай нова">
                  <Wand2 className="h-4 w-4" />
                </Button>
              </div>
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
            <div className="rounded-lg border border-sky-300 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/20 p-3 text-[13px] text-sky-900 dark:text-sky-200 space-y-1">
              <p className="font-medium">Имейлът трябва да е същият като в Office 365.</p>
              <p>
                По него се разпознава колегата при „Вход с Microsoft". Различен
                имейл прави ОТДЕЛЕН потребител без достъп и акаунтът трябва да
                се прави наново.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Ако колегата ще влиза с Microsoft, паролата не му трябва — остава
              като резервен вход. Иначе му я предай (препоръчай да я смени).
              Имейл за потвърждение не се праща.
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
