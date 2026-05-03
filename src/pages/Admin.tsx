import { useState, useEffect } from 'react'
import { getColumns, addColumn, deleteColumn, getDropdownOptions, addDropdownOption, deleteDropdownOption, clearAll, getTags, createTag, deleteTag } from '../lib/storage'
import type { Column, ColumnType, DropdownOption, Tag } from '../lib/types'
import { useAuth } from '../lib/auth'
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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

  const audit = { userId: user?.id, userName: user?.full_name ?? '' }

  useEffect(() => { loadColumns(); loadTags() }, [])

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
    await loadColumns()
  }

  const handleDeleteColumn = async (id: string, name: string) => {
    if (confirm(`Изтриване на колона "${name}"? Всички данни ще бъдат загубени.`)) {
      await deleteColumn(id, { ...audit, columnName: name })
      if (editingDropdown === id) setEditingDropdown(null)
      await loadColumns()
    }
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
    await loadTags()
  }

  const handleDeleteTag = async (id: string, name: string) => {
    if (confirm(`Изтриване на таг "${name}"?`)) {
      await deleteTag(id, { ...audit, tagName: name })
      await loadTags()
    }
  }

  if (loading) return (
    <div className="p-6 flex items-center gap-2 text-muted-foreground">
      <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      Зареждане...
    </div>
  )

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-5">
      <h1 className="text-xl md:text-2xl font-bold text-foreground">Настройки</h1>

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
                    onClick={() => handleDeleteColumn(col.id, col.name)}>
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
                  onClick={() => handleDeleteTag(tag.id, tag.name)}>
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
            onClick={async () => {
              if (confirm('Изчистване на ВСИЧКИ данни? Тази операция е необратима.')) {
                await clearAll()
                window.location.reload()
              }
            }}
          >
            Нулиране на данните
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
