import { useState, useEffect } from 'react'
import { getColumns, addColumn, deleteColumn, getDropdownOptions, addDropdownOption, deleteDropdownOption, clearAll, getTags, createTag, deleteTag, getAllProfiles, updateProfile } from '../lib/storage'
import { adminCreateUser } from '../lib/auth'
import type { Column, ColumnType, DropdownOption, Tag, Profile, Role } from '../lib/types'
import { useAuth } from '../lib/auth'
import { Plus, Trash2, ChevronDown, ChevronRight, UserPlus, Pencil, ShieldCheck, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/alert-dialog'

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Администратор',
  manager: 'Мениджър',
  employee: 'Служител',
}

const ROLE_BADGE_CLASS: Record<Role, string> = {
  admin: 'bg-navy/10 text-navy dark:bg-blue-900/40 dark:text-blue-300',
  manager: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  employee: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
}

const PRESET_COLORS = [
  '#EF4444', '#F59E0B', '#10B981', '#3B82F6',
  '#8B5CF6', '#EC4899', '#6B7280', '#F97316',
]

const TYPE_LABELS: Record<ColumnType, string> = {
  text: 'Текст', number: 'Число', date: 'Дата',
  dropdown: 'Падащо меню', checkbox: 'Отметка', email: 'Имейл', phone: 'Телефон',
}

const selectClass = "h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function AdminPage() {
  const { user } = useAuth()
  const [columns, setColumns] = useState<Column[]>([])
  const [loading, setLoading] = useState(true)
  const [newColName, setNewColName] = useState('')
  const [newColType, setNewColType] = useState<ColumnType>('text')
  const [editingDropdown, setEditingDropdown] = useState<string | null>(null)
  const [newOptValue, setNewOptValue] = useState('')
  const [dropdownOpts, setDropdownOpts] = useState<DropdownOption[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(PRESET_COLORS[0])
  const [confirmDeleteCol, setConfirmDeleteCol] = useState<{ id: string; name: string } | null>(null)
  const [confirmDeleteTag, setConfirmDeleteTag] = useState<{ id: string; name: string } | null>(null)
  const [confirmClearAll, setConfirmClearAll] = useState(false)

  // Users
  const [users, setUsers] = useState<Profile[]>([])
  const [showAddUser, setShowAddUser] = useState(false)
  const [editingUser, setEditingUser] = useState<Profile | null>(null)
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState<Role>('employee')
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState<Role>('employee')
  const [userLoading, setUserLoading] = useState(false)
  const [confirmToggleUser, setConfirmToggleUser] = useState<Profile | null>(null)

  const audit = { userId: user?.id, userName: user?.full_name ?? '' }

  useEffect(() => { loadColumns(); loadTags(); loadUsers() }, [])

  useEffect(() => {
    if (editingDropdown) {
      getDropdownOptions(editingDropdown).then(setDropdownOpts)
    } else {
      setDropdownOpts([])
    }
  }, [editingDropdown])

  async function loadColumns() {
    setLoading(true)
    const cols = await getColumns()
    setColumns(cols)
    setLoading(false)
    if (editingDropdown) {
      const opts = await getDropdownOptions(editingDropdown)
      setDropdownOpts(opts)
    }
  }

  async function loadTags() {
    const t = await getTags()
    setTags(t)
  }

  const handleAddColumn = async () => {
    if (!newColName.trim()) return
    await addColumn(newColName.trim(), newColType, false, user?.id, audit)
    setNewColName('')
    toast.success(`Колона "${newColName.trim()}" е добавена`)
    await loadColumns()
  }

  const handleDeleteColumn = async (id: string, name: string) => {
    await deleteColumn(id, { ...audit, columnName: name })
    if (editingDropdown === id) setEditingDropdown(null)
    setConfirmDeleteCol(null)
    toast.success(`Колона "${name}" е изтрита`)
    await loadColumns()
  }

  const handleAddOption = async () => {
    if (!newOptValue.trim() || !editingDropdown) return
    const colName = columns.find(c => c.id === editingDropdown)?.name
    await addDropdownOption(editingDropdown, newOptValue.trim(), undefined, { ...audit, columnName: colName })
    setNewOptValue('')
    const opts = await getDropdownOptions(editingDropdown)
    setDropdownOpts(opts)
  }

  const handleDeleteOption = async (id: string, optValue: string) => {
    const colName = columns.find(c => c.id === editingDropdown)?.name
    await deleteDropdownOption(id, { ...audit, columnName: colName, optionValue: optValue })
    if (editingDropdown) {
      const opts = await getDropdownOptions(editingDropdown)
      setDropdownOpts(opts)
    }
  }

  const handleAddTag = async () => {
    if (!newTagName.trim()) return
    await createTag(newTagName.trim(), newTagColor, audit)
    setNewTagName('')
    toast.success(`Тагът е добавен`)
    await loadTags()
  }

  const handleDeleteTag = async (id: string, name: string) => {
    await deleteTag(id, { ...audit, tagName: name })
    setConfirmDeleteTag(null)
    toast.success(`Тагът "${name}" е изтрит`)
    await loadTags()
  }

  async function loadUsers() {
    try {
      const profiles = await getAllProfiles()
      setUsers(profiles)
    } catch {
      // Might fail if admin policy not yet applied
    }
  }

  const handleAddUser = async () => {
    if (!newEmail.trim() || !newPassword.trim() || !newName.trim()) return
    setUserLoading(true)
    const { error } = await adminCreateUser(newEmail.trim(), newPassword, newName.trim(), newRole)
    setUserLoading(false)
    if (error) { toast.error(error); return }
    toast.success(`Потребителят "${newName.trim()}" е създаден`)
    setShowAddUser(false)
    setNewEmail(''); setNewPassword(''); setNewName(''); setNewRole('employee')
    await loadUsers()
  }

  const handleEditUser = async () => {
    if (!editingUser || !editName.trim()) return
    setUserLoading(true)
    try {
      await updateProfile(editingUser.id, { full_name: editName.trim(), role: editRole })
      toast.success('Потребителят е обновен')
      setEditingUser(null)
      await loadUsers()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка')
    }
    setUserLoading(false)
  }

  const handleToggleActive = async (u: Profile) => {
    try {
      await updateProfile(u.id, { is_active: !u.is_active })
      toast.success(u.is_active ? `"${u.full_name}" е деактивиран` : `"${u.full_name}" е активиран`)
      setConfirmToggleUser(null)
      await loadUsers()
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

  const initials = (name: string) =>
    name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-5">
      <h1 className="text-xl md:text-2xl font-bold text-foreground">Настройки</h1>

      {/* ── Users ── */}
      <Card>
        <CardHeader className="px-5 pt-5 pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Потребители</CardTitle>
            <Button size="sm" onClick={() => setShowAddUser(v => !v)}>
              <UserPlus className="h-4 w-4" /> Добави
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-3">

          {/* Add user form */}
          {showAddUser && (
            <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
              <p className="text-sm font-medium">Нов потребител</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input placeholder="Имейл" value={newEmail} onChange={e => setNewEmail(e.target.value)} type="email" />
                <Input placeholder="Парола (временна)" value={newPassword} onChange={e => setNewPassword(e.target.value)} type="password" />
                <Input placeholder="Пълно име" value={newName} onChange={e => setNewName(e.target.value)} />
                <select value={newRole} onChange={e => setNewRole(e.target.value as Role)} className={selectClass}>
                  {(Object.keys(ROLE_LABELS) as Role[]).map(r => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddUser}
                  disabled={userLoading || !newEmail.trim() || !newPassword.trim() || !newName.trim()}>
                  {userLoading ? 'Създаване...' : 'Създай'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAddUser(false)}>Отказ</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Потребителят трябва да влезе и да смени паролата си. Уверете се, че имейл потвърждението е изключено в Supabase, или потребителят ще получи имейл за потвърждение.
              </p>
            </div>
          )}

          {/* User list */}
          <div className="space-y-1">
            {users.map(u => (
              <div key={u.id}>
                {editingUser?.id === u.id ? (
                  <div className="border border-border rounded-lg p-3 space-y-2 bg-muted/30">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Пълно име" />
                      <select value={editRole} onChange={e => setEditRole(e.target.value as Role)} className={selectClass}>
                        {(Object.keys(ROLE_LABELS) as Role[]).map(r => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleEditUser} disabled={userLoading || !editName.trim()}>
                        {userLoading ? 'Запазване...' : 'Запази'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingUser(null)}>Отказ</Button>
                    </div>
                  </div>
                ) : (
                  <div className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors hover:bg-muted/50 ${!u.is_active ? 'opacity-50' : ''}`}>
                    <div className="w-8 h-8 rounded-full bg-navy/15 dark:bg-white/10 flex items-center justify-center text-xs font-bold shrink-0 text-navy dark:text-white">
                      {initials(u.full_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate leading-tight">
                        {u.full_name}
                        {u.id === user?.id && <span className="ml-1.5 text-[10px] text-muted-foreground">(вие)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${ROLE_BADGE_CLASS[u.role]}`}>
                      {ROLE_LABELS[u.role]}
                    </span>
                    {!u.is_active && (
                      <span className="text-[10px] text-destructive font-semibold shrink-0">Деактивиран</span>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                      title="Редактирай"
                      onClick={() => { setEditingUser(u); setEditName(u.full_name); setEditRole(u.role) }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {u.id !== user?.id && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                        title={u.is_active ? 'Деактивирай' : 'Активирай'}
                        onClick={() => setConfirmToggleUser(u)}>
                        {u.is_active
                          ? <ShieldOff className="h-3.5 w-3.5 text-destructive/60 hover:text-destructive" />
                          : <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {users.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">Няма потребители или нямате права да ги виждате.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Column Management */}
      <Card>
        <CardHeader className="px-5 pt-5 pb-3">
          <CardTitle className="text-base">Управление на колони</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input
              value={newColName}
              onChange={e => setNewColName(e.target.value)}
              placeholder="Име на нова колона"
              className="flex-1 min-w-0"
              onKeyDown={e => e.key === 'Enter' && handleAddColumn()}
            />
            <select value={newColType} onChange={e => setNewColType(e.target.value as ColumnType)} className={selectClass}>
              {Object.entries(TYPE_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
            <Button onClick={handleAddColumn} disabled={!newColName.trim()} size="sm">
              <Plus className="h-4 w-4" /> Добави
            </Button>
          </div>

          <div className="space-y-1.5">
            {columns.map((col, i) => (
              <div key={col.id}>
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${editingDropdown === col.id ? 'bg-amber-50 ring-1 ring-amber-200' : 'hover:bg-muted/50'}`}>
                  <span className="w-5 text-xs text-muted-foreground/50 shrink-0">{i + 1}</span>
                  <span className="flex-1 text-sm font-medium truncate">{col.name}</span>
                  <Badge variant="muted" className="text-[10px] shrink-0">{TYPE_LABELS[col.type]}</Badge>
                  {col.staff_department && (
                    <Badge variant="success" className="text-[10px] shrink-0">абонаменти</Badge>
                  )}
                  {col.type === 'dropdown' && !col.staff_department && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs px-2 gap-1"
                      onClick={() => setEditingDropdown(editingDropdown === col.id ? null : col.id)}>
                      {editingDropdown === col.id ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      Стойности
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/60 hover:text-destructive shrink-0"
                    onClick={() => setConfirmDeleteCol({ id: col.id, name: col.name })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {/* Inline dropdown editor */}
                {editingDropdown === col.id && (
                  <div className="ml-7 mt-1 mb-2 pl-3 border-l-2 border-amber-200">
                    <div className="flex gap-2 mb-2">
                      <Input
                        value={newOptValue}
                        onChange={e => setNewOptValue(e.target.value)}
                        placeholder="Нова стойност"
                        className="flex-1"
                        onKeyDown={e => e.key === 'Enter' && handleAddOption()}
                      />
                      <Button size="sm" onClick={handleAddOption} disabled={!newOptValue.trim()}
                        className="bg-gold hover:bg-gold-light text-white">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="space-y-1">
                      {dropdownOpts.map(opt => (
                        <div key={opt.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50">
                          <span className="flex-1 text-sm">{opt.value}</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive/60 hover:text-destructive"
                            onClick={() => handleDeleteOption(opt.id, opt.value)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                      {dropdownOpts.length === 0 && (
                        <p className="text-xs text-muted-foreground py-1">Няма стойности</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tag Management */}
      <Card>
        <CardHeader className="px-5 pt-5 pb-3">
          <CardTitle className="text-base">Тагове</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <Input
              value={newTagName}
              onChange={e => setNewTagName(e.target.value)}
              placeholder="Ново наименование на таг"
              className="flex-1 min-w-0"
              onKeyDown={e => e.key === 'Enter' && handleAddTag()}
            />
            <div className="flex gap-1">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setNewTagColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${newTagColor === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <Button size="sm" onClick={handleAddTag} disabled={!newTagName.trim()}>
              <Plus className="h-4 w-4" /> Добави
            </Button>
          </div>

          <div className="space-y-1.5">
            {tags.map(tag => (
              <div key={tag.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50">
                <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                <span className="flex-1 text-sm font-medium">{tag.name}</span>
                <span className="px-2 py-0.5 rounded-full text-xs text-white" style={{ backgroundColor: tag.color }}>
                  {tag.name}
                </span>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/60 hover:text-destructive"
                  onClick={() => setConfirmDeleteTag({ id: tag.id, name: tag.name })}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {tags.length === 0 && <p className="text-sm text-muted-foreground">Няма тагове</p>}
          </div>
        </CardContent>
      </Card>

      {/* Data reset */}
      <Card className="border-destructive/20">
        <CardHeader className="px-5 pt-5 pb-3">
          <CardTitle className="text-base text-destructive">Нулиране на данните</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <p className="text-sm text-muted-foreground mb-3">Изтрива всички клиенти, колони и стойности. Операцията е необратима.</p>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirmClearAll(true)}
          >
            Нулиране на данните
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!confirmDeleteCol}
        title={`Изтриване на колона "${confirmDeleteCol?.name}"?`}
        description="Всички данни в тази колона ще бъдат загубени. Операцията е необратима."
        confirmLabel="Изтрий"
        destructive
        onConfirm={() => confirmDeleteCol && handleDeleteColumn(confirmDeleteCol.id, confirmDeleteCol.name)}
        onCancel={() => setConfirmDeleteCol(null)}
      />

      <ConfirmDialog
        open={!!confirmDeleteTag}
        title={`Изтриване на таг "${confirmDeleteTag?.name}"?`}
        confirmLabel="Изтрий"
        destructive
        onConfirm={() => confirmDeleteTag && handleDeleteTag(confirmDeleteTag.id, confirmDeleteTag.name)}
        onCancel={() => setConfirmDeleteTag(null)}
      />

      <ConfirmDialog
        open={confirmClearAll}
        title="Нулиране на ВСИЧКИ данни?"
        description="Изтрива всички клиенти, колони и стойности. Тази операция е необратима."
        confirmLabel="Нулирай"
        destructive
        onConfirm={async () => { await clearAll(); window.location.reload() }}
        onCancel={() => setConfirmClearAll(false)}
      />

      <ConfirmDialog
        open={!!confirmToggleUser}
        title={confirmToggleUser?.is_active
          ? `Деактивирай "${confirmToggleUser?.full_name}"?`
          : `Активирай "${confirmToggleUser?.full_name}"?`}
        description={confirmToggleUser?.is_active
          ? 'Потребителят няма да може да влиза в системата.'
          : 'Потребителят отново ще може да влиза в системата.'}
        confirmLabel={confirmToggleUser?.is_active ? 'Деактивирай' : 'Активирай'}
        destructive={confirmToggleUser?.is_active}
        onConfirm={() => confirmToggleUser && handleToggleActive(confirmToggleUser)}
        onCancel={() => setConfirmToggleUser(null)}
      />
    </div>
  )
}
