import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../lib/auth'
import { getExpenses, addExpense, updateExpense, deleteExpense, getStaff } from '../lib/storage'
import type { Expense } from '../lib/types'
import { EXPENSE_CATEGORIES } from '../lib/types'
import type { StaffMember } from '../lib/storage'
import type { ExpenseCategory } from '../lib/types'

// ==================== HELPERS ====================

function formatCurrency(amount: number, currency = 'EUR') {
  return new Intl.NumberFormat('bg-BG', { style: 'currency', currency }).format(amount)
}

function getCurrentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
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

// ==================== MAIN PAGE ====================

export function ExpensesPage() {
  const { user } = useAuth()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)

  // Filters
  const [filterMonth, setFilterMonth] = useState(getCurrentMonth())
  const [filterStaff, setFilterStaff] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')

  // Sort
  const [sortField, setSortField] = useState<'date' | 'amount' | 'category'>('date')
  const [sortAsc, setSortAsc] = useState(false)

  const isAdmin = user?.role === 'admin'
  const canEdit = user?.role === 'admin' || user?.role === 'manager'

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [exp, staff] = await Promise.all([getExpenses(), getStaff()])
    setExpenses(exp)
    setStaffList(staff)
    setLoading(false)
  }

  // Filtered + sorted expenses
  const filtered = useMemo(() => {
    let result = expenses.filter(e => {
      if (filterMonth && !e.date.startsWith(filterMonth)) return false
      if (filterStaff !== 'all' && e.staff_id !== filterStaff) return false
      if (filterCategory !== 'all' && e.category !== filterCategory) return false
      return true
    })
    result.sort((a, b) => {
      let cmp = 0
      if (sortField === 'date') cmp = a.date.localeCompare(b.date)
      else if (sortField === 'amount') cmp = a.amount - b.amount
      else cmp = a.category.localeCompare(b.category)
      return sortAsc ? cmp : -cmp
    })
    return result
  }, [expenses, filterMonth, filterStaff, filterCategory, sortField, sortAsc])

  // Summary calculations
  const totalThisMonth = useMemo(() => {
    const month = getCurrentMonth()
    return expenses.filter(e => e.date.startsWith(month)).reduce((s, e) => s + e.amount, 0)
  }, [expenses])

  const byCategory = useMemo(() => {
    const map: Record<string, number> = {}
    filtered.forEach(e => { map[e.category] = (map[e.category] ?? 0) + e.amount })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [filtered])

  const byStaff = useMemo(() => {
    const map: Record<string, number> = {}
    filtered.forEach(e => {
      const name = e.staff_id
        ? staffList.find(s => s.id === e.staff_id)?.full_name ?? 'Неизвестен'
        : 'Без служител'
      map[name] = (map[name] ?? 0) + e.amount
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [filtered, staffList])

  const filteredTotal = useMemo(() => filtered.reduce((s, e) => s + e.amount, 0), [filtered])

  // CRUD handlers
  async function handleSave(data: Omit<Expense, 'id' | 'created_at' | 'updated_at'>) {
    const audit = { userId: user?.id, userName: user?.full_name ?? '' }
    if (editing) {
      await updateExpense(editing.id, data, {
        ...audit,
        oldDescription: `${editing.category}: ${editing.amount} ${editing.currency}`,
      })
    } else {
      await addExpense(data, audit)
    }
    setShowForm(false)
    setEditing(null)
    await loadData()
  }

  async function handleDelete(expense: Expense) {
    if (!window.confirm(`Изтриване на разход "${expense.description || expense.category}"?`)) return
    await deleteExpense(expense.id, {
      userId: user?.id,
      userName: user?.full_name ?? '',
      description: `${expense.category}: ${expense.amount} ${expense.currency}`,
    })
    await loadData()
  }

  function handleSort(field: 'date' | 'amount' | 'category') {
    if (sortField === field) setSortAsc(!sortAsc)
    else { setSortField(field); setSortAsc(false) }
  }

  const sortIcon = (field: string) => sortField === field ? (sortAsc ? ' ▲' : ' ▼') : ''

  const staffName = (id: string | null) => id ? staffList.find(s => s.id === id)?.full_name ?? '—' : '—'

  if (loading) return <div className="p-6 text-dark/50">Зареждане...</div>

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-navy">💰 Разходи</h1>
        {canEdit && (
          <button
            onClick={() => { setEditing(null); setShowForm(true) }}
            className="px-4 py-2 bg-navy text-white rounded-md hover:bg-navy-light transition text-sm font-medium"
          >
            + Нов разход
          </button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-navy">
          <p className="text-sm text-dark/50">Общо този месец</p>
          <p className="text-2xl font-bold text-navy">{formatCurrency(totalThisMonth)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-gold">
          <p className="text-sm text-dark/50">Филтрирани разходи</p>
          <p className="text-2xl font-bold text-gold">{formatCurrency(filteredTotal)}</p>
          <p className="text-xs text-dark/40">{filtered.length} записа</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
          <p className="text-sm text-dark/50">Категории (филтрирани)</p>
          <p className="text-2xl font-bold text-green-600">{byCategory.length}</p>
        </div>
      </div>

      {/* Bar Chart by Category */}
      {byCategory.length > 0 && (
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <h2 className="text-sm font-semibold text-navy mb-3">Разходи по категория</h2>
          <div className="space-y-2">
            {byCategory.map(([cat, amount]) => {
              const pct = filteredTotal > 0 ? (amount / filteredTotal) * 100 : 0
              return (
                <div key={cat} className="flex items-center gap-3">
                  <span className="text-xs w-24 text-right text-dark/60 shrink-0">{cat}</span>
                  <div className="flex-1 bg-light rounded-full h-5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${pct}%`, backgroundColor: CATEGORY_COLORS[cat] ?? '#9ca3af' }}
                    />
                  </div>
                  <span className="text-xs w-28 text-dark/70 shrink-0">{formatCurrency(amount)} ({pct.toFixed(0)}%)</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Top staff spenders */}
      {byStaff.length > 1 && (
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <h2 className="text-sm font-semibold text-navy mb-3">Разходи по служител</h2>
          <div className="space-y-2">
            {byStaff.map(([name, amount]) => {
              const pct = filteredTotal > 0 ? (amount / filteredTotal) * 100 : 0
              return (
                <div key={name} className="flex items-center gap-3">
                  <span className="text-xs w-32 text-right text-dark/60 shrink-0 truncate">{name}</span>
                  <div className="flex-1 bg-light rounded-full h-5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-navy/70 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs w-28 text-dark/70 shrink-0">{formatCurrency(amount)} ({pct.toFixed(0)}%)</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="month"
          value={filterMonth}
          onChange={e => setFilterMonth(e.target.value)}
          className="px-3 py-2 border border-light rounded-md text-sm"
        />
        <select
          value={filterStaff}
          onChange={e => setFilterStaff(e.target.value)}
          className="px-3 py-2 border border-light rounded-md text-sm"
        >
          <option value="all">Всички служители</option>
          {staffList.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="px-3 py-2 border border-light rounded-md text-sm"
        >
          <option value="all">Всички категории</option>
          {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {(filterMonth || filterStaff !== 'all' || filterCategory !== 'all') && (
          <button
            onClick={() => { setFilterMonth(''); setFilterStaff('all'); setFilterCategory('all') }}
            className="text-xs text-dark/40 hover:text-dark underline"
          >
            Изчисти филтри
          </button>
        )}
      </div>

      {/* Expenses Table */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-light bg-light/50">
              <th className="px-4 py-3 text-left cursor-pointer select-none" onClick={() => handleSort('date')}>
                Дата{sortIcon('date')}
              </th>
              <th className="px-4 py-3 text-left cursor-pointer select-none" onClick={() => handleSort('category')}>
                Категория{sortIcon('category')}
              </th>
              <th className="px-4 py-3 text-left">Описание</th>
              <th className="px-4 py-3 text-left">Служител</th>
              <th className="px-4 py-3 text-right cursor-pointer select-none" onClick={() => handleSort('amount')}>
                Сума{sortIcon('amount')}
              </th>
              <th className="px-4 py-3 text-center">Повтарящ</th>
              {canEdit && <th className="px-4 py-3 text-right">Действия</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={canEdit ? 7 : 6} className="px-4 py-8 text-center text-dark/40">Няма разходи за избрания период</td></tr>
            )}
            {filtered.map(expense => (
              <tr key={expense.id} className="border-b border-light/50 hover:bg-light/30 transition">
                <td className="px-4 py-3 whitespace-nowrap">{expense.date}</td>
                <td className="px-4 py-3">
                  <span
                    className="inline-block px-2 py-0.5 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: CATEGORY_COLORS[expense.category] ?? '#9ca3af' }}
                  >
                    {expense.category}
                  </span>
                </td>
                <td className="px-4 py-3 text-dark/70">{expense.description || '—'}</td>
                <td className="px-4 py-3 text-dark/70">{staffName(expense.staff_id)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(expense.amount, expense.currency)}</td>
                <td className="px-4 py-3 text-center">
                  {expense.recurring ? (
                    <span className="text-xs text-green-600" title={expense.recurring_period ?? ''}>
                      ✓ {expense.recurring_period === 'monthly' ? 'месечно' : expense.recurring_period === 'quarterly' ? 'тримесечно' : expense.recurring_period === 'yearly' ? 'годишно' : expense.recurring_period ?? ''}
                    </span>
                  ) : '—'}
                </td>
                {canEdit && (
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => { setEditing(expense); setShowForm(true) }} className="text-xs text-navy hover:underline mr-2">✏️</button>
                    {isAdmin && (
                      <button onClick={() => handleDelete(expense)} className="text-xs text-red-500 hover:underline">🗑️</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Form Modal */}
      {showForm && (
        <ExpenseForm
          expense={editing}
          staffList={staffList}
          userId={user?.id}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditing(null) }}
        />
      )}
    </div>
  )
}

// ==================== EXPENSE FORM MODAL ====================

function ExpenseForm({ expense, staffList, userId, onSave, onClose }: {
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
  const [date, setDate] = useState(expense?.date ?? new Date().toISOString().slice(0, 10))
  const [staffId, setStaffId] = useState(expense?.staff_id ?? '')
  const [recurring, setRecurring] = useState(expense?.recurring ?? false)
  const [recurringPeriod, setRecurringPeriod] = useState(expense?.recurring_period ?? 'monthly')

  function handleSubmit() {
    const amt = parseFloat(amount)
    if (!category || isNaN(amt) || amt <= 0 || !date) return
    onSave({
      category,
      description: description.trim() || null,
      amount: amt,
      currency,
      date,
      staff_id: staffId || null,
      recurring,
      recurring_period: recurring ? recurringPeriod : null,
      created_by: expense?.created_by ?? userId ?? null,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-navy mb-4">
          {expense ? 'Редактирай разход' : 'Нов разход'}
        </h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Категория *</label>
            <select value={category} onChange={e => setCategory(e.target.value as ExpenseCategory)}
              className="w-full px-3 py-2 border border-light rounded-md">
              {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Описание</label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Кратко описание..."
              className="w-full px-3 py-2 border border-light rounded-md focus:outline-none focus:ring-2 focus:ring-navy" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-dark mb-1">Сума *</label>
              <input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)}
                className="w-full px-3 py-2 border border-light rounded-md focus:outline-none focus:ring-2 focus:ring-navy" />
            </div>
            <div>
              <label className="block text-sm font-medium text-dark mb-1">Валута</label>
              <select value={currency} onChange={e => setCurrency(e.target.value)}
                className="w-full px-3 py-2 border border-light rounded-md">
                <option value="EUR">EUR</option>
                <option value="BGN">BGN</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Дата *</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2 border border-light rounded-md focus:outline-none focus:ring-2 focus:ring-navy" />
          </div>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Служител</label>
            <select value={staffId} onChange={e => setStaffId(e.target.value)}
              className="w-full px-3 py-2 border border-light rounded-md">
              <option value="">— Без служител —</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={recurring} onChange={e => setRecurring(e.target.checked)}
                className="rounded border-light" />
              Повтарящ се разход
            </label>
            {recurring && (
              <select value={recurringPeriod} onChange={e => setRecurringPeriod(e.target.value)}
                className="px-3 py-1 border border-light rounded-md text-sm">
                <option value="monthly">Месечно</option>
                <option value="quarterly">Тримесечно</option>
                <option value="yearly">Годишно</option>
              </select>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 border border-light rounded-md text-sm hover:bg-light transition">
            Отказ
          </button>
          <button onClick={handleSubmit}
            className="px-4 py-2 bg-navy text-white rounded-md hover:bg-navy-light transition text-sm font-medium">
            {expense ? 'Запази' : 'Добави'}
          </button>
        </div>
      </div>
    </div>
  )
}
