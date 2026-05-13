import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../lib/auth'
import { getExpenses, addExpense, updateExpense, deleteExpense, getStaff } from '../lib/storage'
import type { Expense } from '../lib/types'
import { EXPENSE_CATEGORIES } from '../lib/types'
import type { StaffMember } from '../lib/storage'
import type { ExpenseCategory } from '../lib/types'
import { Plus, Pencil, Trash2, TrendingDown, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/alert-dialog'

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

type Tab = 'salaries' | 'other'

export function ExpensesPage() {
  const { user } = useAuth()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('salaries')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Expense | null>(null)
  const [filterCategory, setFilterCategory] = useState('all')
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

  const salaryExpenses = useMemo(() => expenses.filter(e => e.category === 'Заплати'), [expenses])
  const otherExpenses = useMemo(() => expenses.filter(e => e.category !== 'Заплати'), [expenses])

  const totalMonthly = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses])
  const totalSalaries = useMemo(() => salaryExpenses.reduce((s, e) => s + e.amount, 0), [salaryExpenses])
  const totalOther = useMemo(() => otherExpenses.reduce((s, e) => s + e.amount, 0), [otherExpenses])

  const filteredOther = useMemo(() => {
    let result = filterCategory !== 'all'
      ? otherExpenses.filter(e => e.category === filterCategory)
      : [...otherExpenses]
    result.sort((a, b) => sortAsc ? a.amount - b.amount : b.amount - a.amount)
    return result
  }, [otherExpenses, filterCategory, sortAsc])

  const otherByCategory = useMemo(() => {
    const map: Record<string, number> = {}
    otherExpenses.forEach(e => { map[e.category] = (map[e.category] ?? 0) + e.amount })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [otherExpenses])

  const salariesByEmployee = useMemo(() => {
    const map: Record<string, { sum: number; entries: Expense[] }> = {}
    salaryExpenses.forEach(e => {
      const name = e.staff_id ? staffList.find(s => s.id === e.staff_id)?.full_name ?? 'Неизвестен' : 'Без служител'
      if (!map[name]) map[name] = { sum: 0, entries: [] }
      map[name].sum += e.amount
      map[name].entries.push(e)
    })
    return Object.entries(map).sort((a, b) => b[1].sum - a[1].sum)
  }, [salaryExpenses, staffList])

  async function handleSave(data: Omit<Expense, 'id' | 'created_at' | 'updated_at'>) {
    const audit = { userId: user?.id, userName: user?.full_name ?? '' }
    try {
      if (editing) {
        await updateExpense(editing.id, data, { ...audit, oldDescription: `${editing.category}: ${editing.amount} ${editing.currency}` })
        toast.success('Разходът е обновен')
      } else {
        await addExpense(data, audit)
        toast.success('Разходът е добавен')
      }
      setShowForm(false)
      setEditing(null)
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Грешка при запис.')
    }
  }

  async function handleDelete(expense: Expense) {
    await deleteExpense(expense.id, {
      userId: user?.id, userName: user?.full_name ?? '',
      description: `${expense.category}: ${expense.amount} ${expense.currency}`,
    })
    setConfirmDelete(null)
    toast.success('Разходът е изтрит')
    await loadData()
  }

  const staffName = (id: string | null) => id ? staffList.find(s => s.id === id)?.full_name ?? '—' : '—'
  const otherCategories = EXPENSE_CATEGORIES.filter(c => c !== 'Заплати')

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
            <span className="hidden sm:inline">{activeTab === 'salaries' ? 'Нова заплата' : 'Нов разход'}</span>
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
            <CardTitle className="text-sm font-medium text-muted-foreground">Заплати</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <p className="text-2xl font-bold text-navy">{formatCurrency(totalSalaries)}</p>
            {totalMonthly > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {Math.round((totalSalaries / totalMonthly) * 100)}% от общото
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-medium text-muted-foreground">Други разходи</CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <p className="text-2xl font-bold text-gold">{formatCurrency(totalOther)}</p>
            {totalMonthly > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {Math.round((totalOther / totalMonthly) * 100)}% от общото
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex gap-0">
          {([['salaries', 'Заплати', salaryExpenses.length], ['other', 'Други разходи', otherExpenses.length]] as const).map(([tab, label, count]) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setFilterCategory('all') }}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-navy text-navy'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                activeTab === tab ? 'bg-navy text-white' : 'bg-muted text-muted-foreground'
              }`}>{count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab: Заплати */}
      {activeTab === 'salaries' && (
        <div className="space-y-4">
          {salariesByEmployee.length > 0 && (
            <Card>
              <CardHeader className="px-5 pt-4 pb-2">
                <CardTitle className="text-sm font-semibold">Заплати по служител</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4 space-y-2.5">
                {salariesByEmployee.map(([name, { sum }]) => {
                  const pct = totalSalaries > 0 ? (sum / totalSalaries) * 100 : 0
                  return (
                    <div key={name} className="flex items-center gap-3">
                      <span className="text-sm w-36 text-muted-foreground truncate shrink-0">{name}</span>
                      <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
                        <div
                          className="h-full bg-navy rounded-full transition-all flex items-center justify-end pr-2"
                          style={{ width: `${Math.max(pct, 8)}%` }}
                        >
                          <span className="text-[10px] text-white font-medium">{formatCurrency(sum)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          )}

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Служител</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Описание</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">Сума</th>
                    {canEdit && <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">Действия</th>}
                  </tr>
                </thead>
                <tbody>
                  {salaryExpenses.length === 0 && (
                    <tr><td colSpan={canEdit ? 4 : 3} className="px-4 py-10 text-center text-muted-foreground">Няма добавени заплати</td></tr>
                  )}
                  {salaryExpenses.map((expense, i) => (
                    <tr key={expense.id} className={`border-b border-border/50 transition-colors hover:bg-muted/30 ${i % 2 === 0 ? '' : 'bg-muted/10'}`}>
                      <td className="px-4 py-3 font-medium">{staffName(expense.staff_id)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{expense.description || <span className="text-muted-foreground/40">—</span>}</td>
                      <td className="px-4 py-3 text-right font-semibold">{formatCurrency(expense.amount, expense.currency)}</td>
                      {canEdit && (
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"
                            onClick={() => { setEditing(expense); setShowForm(true) }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {isAdmin && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => setConfirmDelete(expense)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {salaryExpenses.length > 0 && (
                    <tr className="bg-muted/20 font-semibold">
                      <td className="px-4 py-2 text-sm" colSpan={2}>Общо заплати</td>
                      <td className="px-4 py-2 text-right text-sm">{formatCurrency(totalSalaries)}</td>
                      {canEdit && <td />}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Tab: Други разходи */}
      {activeTab === 'other' && (
        <div className="space-y-4">
          {otherByCategory.length > 0 && (
            <Card>
              <CardHeader className="px-5 pt-4 pb-2">
                <CardTitle className="text-sm font-semibold">Разходи по категория</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4 space-y-2">
                {otherByCategory.map(([cat, amount]) => {
                  const pct = totalOther > 0 ? (amount / totalOther) * 100 : 0
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

          {/* Filter */}
          <div className="flex flex-wrap items-center gap-2">
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="all">Всички категории</option>
              {otherCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button
              onClick={() => setSortAsc(v => !v)}
              className="h-9 px-3 rounded-md border border-input bg-background text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Сума {sortAsc ? '↑' : '↓'}
            </button>
            {filterCategory !== 'all' && (
              <Button variant="ghost" size="sm" onClick={() => setFilterCategory('all')}
                className="text-muted-foreground text-xs h-9">
                ✕ Изчисти
              </Button>
            )}
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Категория</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Описание</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">Сума</th>
                    {canEdit && <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">Действия</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredOther.length === 0 && (
                    <tr><td colSpan={canEdit ? 4 : 3} className="px-4 py-10 text-center text-muted-foreground">Няма разходи</td></tr>
                  )}
                  {filteredOther.map((expense, i) => (
                    <tr key={expense.id} className={`border-b border-border/50 transition-colors hover:bg-muted/30 ${i % 2 === 0 ? '' : 'bg-muted/10'}`}>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white"
                          style={{ backgroundColor: CATEGORY_COLORS[expense.category] ?? '#9ca3af' }}>
                          {expense.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{expense.description || <span className="text-muted-foreground/40">—</span>}</td>
                      <td className="px-4 py-3 text-right font-semibold">{formatCurrency(expense.amount, expense.currency)}</td>
                      {canEdit && (
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"
                            onClick={() => { setEditing(expense); setShowForm(true) }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {isAdmin && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => setConfirmDelete(expense)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {filteredOther.length > 0 && (
                    <tr className="bg-muted/20 font-semibold">
                      <td className="px-4 py-2 text-sm" colSpan={2}>
                        Общо{filterCategory !== 'all' ? ` (${filterCategory})` : ''}
                      </td>
                      <td className="px-4 py-2 text-right text-sm">
                        {formatCurrency(filteredOther.reduce((s, e) => s + e.amount, 0))}
                      </td>
                      {canEdit && <td />}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      <ExpenseForm
        open={showForm}
        expense={editing}
        staffList={staffList}
        userId={user?.id}
        defaultCategory={activeTab === 'salaries' ? 'Заплати' : undefined}
        onSave={handleSave}
        onClose={() => { setShowForm(false); setEditing(null) }}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title={`Изтриване на "${confirmDelete?.description || confirmDelete?.category}"?`}
        description="Тази операция е необратима."
        confirmLabel="Изтрий"
        destructive
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}

function ExpenseForm({ open, expense, staffList, userId, defaultCategory, onSave, onClose }: {
  open: boolean
  expense: Expense | null
  staffList: StaffMember[]
  userId?: string
  defaultCategory?: ExpenseCategory
  onSave: (data: Omit<Expense, 'id' | 'created_at' | 'updated_at'>) => void
  onClose: () => void
}) {
  const initCategory = (): ExpenseCategory =>
    (expense?.category as ExpenseCategory) ?? defaultCategory ?? 'Други'

  const [category, setCategory] = useState<ExpenseCategory>(initCategory)
  const [description, setDescription] = useState(expense?.description ?? '')
  const [amount, setAmount] = useState(expense?.amount?.toString() ?? '')
  const [currency, setCurrency] = useState(expense?.currency ?? 'EUR')
  const [staffId, setStaffId] = useState(expense?.staff_id ?? '')
  const [amountError, setAmountError] = useState('')

  useEffect(() => {
    if (open) {
      setCategory(initCategory())
      setDescription(expense?.description ?? '')
      setAmount(expense?.amount?.toString() ?? '')
      setCurrency(expense?.currency ?? 'EUR')
      setStaffId(expense?.staff_id ?? '')
      setAmountError('')
    }
  }, [open, expense])

  useEffect(() => {
    if (category !== 'Заплати') setStaffId('')
  }, [category])

  function handleSubmit() {
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) {
      setAmountError('Въведете сума по-голяма от 0')
      return
    }
    setAmountError('')
    onSave({
      category,
      description: description.trim() || null,
      amount: amt,
      currency,
      date: expense?.date ?? new Date().toISOString().split('T')[0],
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
          <DialogTitle>{expense ? 'Редактирай разход' : category === 'Заплати' ? 'Нова заплата' : 'Нов разход'}</DialogTitle>
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
              <Input
                type="number" step="0.01" min="0.01" value={amount}
                onChange={e => { setAmount(e.target.value); setAmountError('') }}
                placeholder="0.00"
                className={amountError ? 'border-red-500 focus-visible:ring-red-500' : ''}
              />
              {amountError && <p className="text-xs text-red-500">{amountError}</p>}
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
          {category === 'Заплати' && (
            <div className="space-y-1.5">
              <Label>Служител</Label>
              <select value={staffId} onChange={e => setStaffId(e.target.value)} className={selectClass}>
                <option value="">— Без служител —</option>
                {staffList.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отказ</Button>
          <Button onClick={handleSubmit}>{expense ? 'Запази' : 'Добави'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
