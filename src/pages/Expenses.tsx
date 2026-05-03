import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../lib/auth'
import { getExpenses, addExpense, updateExpense, deleteExpense, getStaff } from '../lib/storage'
import type { Expense } from '../lib/types'
import { EXPENSE_CATEGORIES } from '../lib/types'
import type { StaffMember } from '../lib/storage'
import type { ExpenseCategory } from '../lib/types'
import { Plus, Pencil, Trash2, TrendingDown, Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'

function formatCurrency(amount: number, currency = 'EUR') {
  return new Intl.NumberFormat('bg-BG', { style: 'currency', currency }).format(amount)
}

const CATEGORY_COLORS: Record<string, string> = {
  'Заплати': '#1e3a5f',
  'Наем': '#d4a017',
  'Софтуер': '#6366f1',
  'Реклама': '#f59e0b',
  'Консумативи': '#10b981',
  'Комунални': '#ef4444',
  'Транспорт': '#8b5cf6',
  'Обучения': '#06b6d4',
  'Други': '#9ca3af',
}

export function ExpensesPage() {
  const { user } = useAuth()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [filterStaff, setFilterStaff] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [sortField, setSortField] = useState<'amount' | 'category'>('amount')
  const [sortAsc, setSortAsc] = useState(false)

  const isAdmin = user?.role === 'admin'
  const canEdit = user?.role === 'admin' || user?.role === 'manager'

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    let exp: Expense[] = []
    let staff: StaffMember[] = []
    try { exp = await getExpenses() } catch { /* */ }
    try { staff = await getStaff() } catch { /* */ }
    setExpenses(exp)
    setStaffList(staff)
    setLoading(false)
  }

  const filtered = useMemo(() => {
    let result = expenses.filter(e => {
      if (filterStaff !== 'all' && e.staff_id !== filterStaff) return false
      if (filterCategory !== 'all' && e.category !== filterCategory) return false
      return true
    })
    result.sort((a, b) => {
      const cmp = sortField === 'amount' ? a.amount - b.amount : a.category.localeCompare(b.category)
      return sortAsc ? cmp : -cmp
    })
    return result
  }, [expenses, filterStaff, filterCategory, sortField, sortAsc])

  const totalMonthly = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses])
  const filteredTotal = useMemo(() => filtered.reduce((s, e) => s + e.amount, 0), [filtered])

  const byCategory = useMemo(() => {
    const map: Record<string, number> = {}
    filtered.forEach(e => { map[e.category] = (map[e.category] ?? 0) + e.amount })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [filtered])

  const byStaff = useMemo(() => {
    const map: Record<string, number> = {}
    filtered.forEach(e => {
      const name = e.staff_id ? staffList.find(s => s.id === e.staff_id)?.full_name ?? 'Неизвестен' : 'Без служител'
      map[name] = (map[name] ?? 0) + e.amount
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [filtered, staffList])

  async function handleSave(data: Omit<Expense, 'id' | 'created_at' | 'updated_at'>) {
    const audit = { userId: user?.id, userName: user?.full_name ?? '' }
    try {
      if (editing) {
        await updateExpense(editing.id, data, { ...audit, oldDescription: `${editing.category}: ${editing.amount} ${editing.currency}` })
      } else {
        await addExpense(data, audit)
      }
      setShowForm(false)
      setEditing(null)
      await loadData()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Грешка при запис.')
    }
  }

  async function handleDelete(expense: Expense) {
    if (!window.confirm(`Изтриване на "${expense.description || expense.category}"?`)) return
    await deleteExpense(expense.id, {
      userId: user?.id, userName: user?.full_name ?? '',
      description: `${expense.category}: ${expense.amount} ${expense.currency}`,
    })
    await loadData()
  }

  function handleSort(field: 'amount' | 'category') {
    if (sortField === field) setSortAsc(!sortAsc)
    else { setSortField(field); setSortAsc(false) }
  }

  const sortIcon = (field: string) => sortField === field ? (sortAsc ? ' ↑' : ' ↓') : ''
  const staffName = (id: string | null) => id ? staffList.find(s => s.id === id)?.full_name ?? '—' : '—'
  const hasFilters = filterStaff !== 'all' || filterCategory !== 'all'

  if (loading) return (
    <div className="p-6 flex items-center gap-2 text-muted-foreground">
      <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      Зареждане...
    </div>
  )

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl md:text-2xl font-bold text-foreground">Месечни разходи</h1>
        {canEdit && (
          <Button size="sm" onClick={() => { setEditing(null); setShowForm(true) }}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Нов разход</span>
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-medium text-muted-foreground">Общо разходи</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-400" />
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <p className="text-2xl font-bold text-red-500">{formatCurrency(totalMonthly)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-medium text-muted-foreground">Филтрирано</CardTitle>
            <Filter className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <p className="text-2xl font-bold text-gold">{formatCurrency(filteredTotal)}</p>
            <p className="text-xs text-muted-foreground">{filtered.length} записа</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-medium text-muted-foreground">Категории</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <p className="text-2xl font-bold text-green-600">{byCategory.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Bar charts */}
      {byCategory.length > 0 && (
        <Card>
          <CardHeader className="px-5 pt-4 pb-2">
            <CardTitle className="text-sm font-semibold">Разходи по категория</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4 space-y-2">
            {byCategory.map(([cat, amount]) => {
              const pct = filteredTotal > 0 ? (amount / filteredTotal) * 100 : 0
              return (
                <div key={cat} className="flex items-center gap-3">
                  <span className="text-xs w-24 text-right text-muted-foreground shrink-0">{cat}</span>
                  <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${pct}%`, backgroundColor: CATEGORY_COLORS[cat] ?? '#9ca3af' }} />
                  </div>
                  <span className="text-xs w-28 text-muted-foreground shrink-0 text-right">{formatCurrency(amount)}</span>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {byStaff.length > 1 && (
        <Card>
          <CardHeader className="px-5 pt-4 pb-2">
            <CardTitle className="text-sm font-semibold">Разходи по служител</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4 space-y-2">
            {byStaff.map(([name, amount]) => {
              const pct = filteredTotal > 0 ? (amount / filteredTotal) * 100 : 0
              return (
                <div key={name} className="flex items-center gap-3">
                  <span className="text-xs w-32 text-right text-muted-foreground shrink-0 truncate">{name}</span>
                  <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full bg-primary/70 transition-all duration-300" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs w-28 text-muted-foreground shrink-0 text-right">{formatCurrency(amount)}</span>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={filterStaff} onChange={e => setFilterStaff(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="all">Всички служители</option>
          {staffList.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="all">Всички категории</option>
          {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => { setFilterStaff('all'); setFilterCategory('all') }}
            className="text-muted-foreground text-xs h-9">
            ✕ Изчисти
          </Button>
        )}
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left cursor-pointer select-none font-medium text-muted-foreground text-xs uppercase tracking-wider"
                  onClick={() => handleSort('category')}>
                  Категория{sortIcon('category')}
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Описание</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Служител</th>
                <th className="px-4 py-3 text-right cursor-pointer select-none font-medium text-muted-foreground text-xs uppercase tracking-wider"
                  onClick={() => handleSort('amount')}>
                  Сума{sortIcon('amount')}
                </th>
                {canEdit && <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">Действия</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={canEdit ? 5 : 4} className="px-4 py-10 text-center text-muted-foreground">Няма разходи</td></tr>
              )}
              {filtered.map((expense, i) => (
                <tr key={expense.id} className={`border-b border-border/50 transition-colors hover:bg-muted/30 ${i % 2 === 0 ? '' : 'bg-muted/10'}`}>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white"
                      style={{ backgroundColor: CATEGORY_COLORS[expense.category] ?? '#9ca3af' }}>
                      {expense.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{expense.description || <span className="text-muted-foreground/40">—</span>}</td>
                  <td className="px-4 py-3 text-muted-foreground">{staffName(expense.staff_id)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatCurrency(expense.amount, expense.currency)}</td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"
                        onClick={() => { setEditing(expense); setShowForm(true) }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {isAdmin && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(expense)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ExpenseForm
        open={showForm}
        expense={editing}
        staffList={staffList}
        userId={user?.id}
        onSave={handleSave}
        onClose={() => { setShowForm(false); setEditing(null) }}
      />
    </div>
  )
}

function ExpenseForm({ open, expense, staffList, userId, onSave, onClose }: {
  open: boolean
  expense: Expense | null
  staffList: StaffMember[]
  userId?: string
  onSave: (data: Omit<Expense, 'id' | 'created_at' | 'updated_at'>) => void
  onClose: () => void
}) {
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category as ExpenseCategory ?? 'Други')
  const [description, setDescription] = useState(expense?.description ?? '')
  const [amount, setAmount] = useState(expense?.amount?.toString() ?? '')
  const [currency, setCurrency] = useState(expense?.currency ?? 'EUR')
  const [staffId, setStaffId] = useState(expense?.staff_id ?? '')

  useEffect(() => {
    if (open) {
      setCategory(expense?.category as ExpenseCategory ?? 'Други')
      setDescription(expense?.description ?? '')
      setAmount(expense?.amount?.toString() ?? '')
      setCurrency(expense?.currency ?? 'EUR')
      setStaffId(expense?.staff_id ?? '')
    }
  }, [open, expense])

  function handleSubmit() {
    const amt = parseFloat(amount)
    if (!category || isNaN(amt) || amt <= 0) return
    const today = new Date().toISOString().split('T')[0]
    onSave({
      category,
      description: description.trim() || null,
      amount: amt,
      currency,
      date: expense?.date ?? today,
      staff_id: staffId || null,
      recurring: true,
      recurring_period: 'monthly',
      created_by: expense?.created_by ?? userId ?? null,
    })
  }

  const selectClass = "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{expense ? 'Редактирай разход' : 'Нов месечен разход'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Категория *</Label>
            <select value={category} onChange={e => setCategory(e.target.value as ExpenseCategory)} className={selectClass}>
              {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Описание</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Кратко описание..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Месечна сума *</Label>
              <Input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1.5">
              <Label>Валута</Label>
              <select value={currency} onChange={e => setCurrency(e.target.value)} className={selectClass}>
                <option value="EUR">EUR</option>
                <option value="BGN">BGN</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Служител</Label>
            <select value={staffId} onChange={e => setStaffId(e.target.value)} className={selectClass}>
              <option value="">— Без служител —</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отказ</Button>
          <Button onClick={handleSubmit} disabled={!category || !amount}>{expense ? 'Запази' : 'Добави'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
