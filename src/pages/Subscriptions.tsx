import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../lib/auth'
import { getSubscriptions, addSubscription, updateSubscription, deleteSubscription, getClients, getCellValues, getColumns } from '../lib/storage'
import type { Subscription, Client, CellValue, Column } from '../lib/types'

function formatCurrency(amount: number, currency = 'EUR') {
  return new Intl.NumberFormat('bg-BG', { style: 'currency', currency }).format(amount)
}

const PERIOD_LABELS: Record<string, string> = {
  monthly: 'Месечно',
  quarterly: 'Тримесечно',
  yearly: 'Годишно',
}

export function SubscriptionsPage() {
  const { user } = useAuth()
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [cellValues, setCellValues] = useState<CellValue[]>([])
  const [columns, setColumns] = useState<Column[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Subscription | null>(null)

  // Filters
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('active')
  const [filterAmountMin, setFilterAmountMin] = useState('')
  const [filterAmountMax, setFilterAmountMax] = useState('')

  // Sort
  const [sortField, setSortField] = useState<'client' | 'amount'>('amount')
  const [sortAsc, setSortAsc] = useState(false)

  const isAdmin = user?.role === 'admin'
  const canEdit = user?.role === 'admin' || user?.role === 'manager'

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [subs, cls, cells, cols] = await Promise.all([
      getSubscriptions().catch(() => []),
      getClients().catch(() => []),
      getCellValues().catch(() => []),
      getColumns().catch(() => []),
    ])
    setSubscriptions(subs)
    setClients(cls)
    setCellValues(cells)
    setColumns(cols)
    setLoading(false)
  }

  // Find the first text column to use as client name
  const firstTextCol = useMemo(() => columns.find(c => c.type === 'text'), [columns])

  function clientName(clientId: string): string {
    if (!firstTextCol) return clientId.slice(0, 8)
    const cell = cellValues.find(cv => cv.client_id === clientId && cv.column_id === firstTextCol.id)
    return cell?.value_text || clientId.slice(0, 8)
  }

  const filtered = useMemo(() => {
    const minAmt = parseFloat(filterAmountMin) || 0
    const maxAmt = parseFloat(filterAmountMax) || Infinity
    let result = subscriptions.filter(s => {
      if (filterActive === 'active' && !s.is_active) return false
      if (filterActive === 'inactive' && s.is_active) return false
      if (s.amount < minAmt) return false
      if (s.amount > maxAmt) return false
      return true
    })
    result.sort((a, b) => {
      let cmp = 0
      if (sortField === 'amount') cmp = a.amount - b.amount
      else cmp = clientName(a.client_id).localeCompare(clientName(b.client_id))
      return sortAsc ? cmp : -cmp
    })
    return result
  }, [subscriptions, filterActive, filterAmountMin, filterAmountMax, sortField, sortAsc, cellValues, columns])

  // Summary stats
  const activeSubs = useMemo(() => subscriptions.filter(s => s.is_active), [subscriptions])
  const totalMonthlyRevenue = useMemo(() => {
    return activeSubs.reduce((sum, s) => {
      if (s.payment_period === 'monthly') return sum + s.amount
      if (s.payment_period === 'quarterly') return sum + s.amount / 3
      if (s.payment_period === 'yearly') return sum + s.amount / 12
      return sum + s.amount
    }, 0)
  }, [activeSubs])
  const avgSubscription = activeSubs.length > 0 ? totalMonthlyRevenue / activeSubs.length : 0

  // Bar chart data — top clients by amount
  const byClient = useMemo(() => {
    const map: Record<string, number> = {}
    filtered.forEach(s => {
      const name = clientName(s.client_id)
      let monthly = s.amount
      if (s.payment_period === 'quarterly') monthly = s.amount / 3
      if (s.payment_period === 'yearly') monthly = s.amount / 12
      map[name] = (map[name] ?? 0) + monthly
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 15)
  }, [filtered, cellValues, columns])

  const maxBarValue = byClient.length > 0 ? byClient[0][1] : 0

  async function handleSave(data: Omit<Subscription, 'id' | 'created_at' | 'updated_at'>) {
    const audit = { userId: user?.id, userName: user?.full_name ?? '' }
    if (editing) {
      await updateSubscription(editing.id, data, {
        ...audit,
        oldDescription: `${editing.amount} ${editing.currency}`,
      })
    } else {
      await addSubscription(data, audit)
    }
    setShowForm(false)
    setEditing(null)
    await loadData()
  }

  async function handleDelete(sub: Subscription) {
    const name = clientName(sub.client_id)
    if (!window.confirm(`Изтриване на абонамент за "${name}"?`)) return
    await deleteSubscription(sub.id, {
      userId: user?.id,
      userName: user?.full_name ?? '',
      description: `${name}: ${sub.amount} ${sub.currency}`,
    })
    await loadData()
  }

  async function handleToggleActive(sub: Subscription) {
    const audit = { userId: user?.id, userName: user?.full_name ?? '' }
    await updateSubscription(sub.id, { is_active: !sub.is_active }, {
      ...audit,
      oldDescription: `Активен: ${sub.is_active ? 'Да' : 'Не'}`,
    })
    await loadData()
  }

  function handleSort(field: 'client' | 'amount') {
    if (sortField === field) setSortAsc(!sortAsc)
    else { setSortField(field); setSortAsc(false) }
  }

  const sortIcon = (field: string) => sortField === field ? (sortAsc ? ' ▲' : ' ▼') : ''

  if (loading) return <div className="p-6 text-dark/50">Зареждане...</div>

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-navy">💶 Абонаменти</h1>
        {canEdit && (
          <button
            onClick={() => { setEditing(null); setShowForm(true) }}
            className="px-4 py-2 bg-navy text-white rounded-md hover:bg-navy-light transition text-sm font-medium"
          >
            + Нов абонамент
          </button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
          <p className="text-sm text-dark/50">Общ месечен приход</p>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(totalMonthlyRevenue)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-navy">
          <p className="text-sm text-dark/50">Активни абонаменти</p>
          <p className="text-2xl font-bold text-navy">{activeSubs.length}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-gold">
          <p className="text-sm text-dark/50">Среден абонамент</p>
          <p className="text-2xl font-bold text-gold">{formatCurrency(avgSubscription)}</p>
        </div>
      </div>

      {/* Bar chart — top clients */}
      {byClient.length > 0 && (
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <h2 className="text-sm font-semibold text-navy mb-3">Приход по клиент (месечно)</h2>
          <div className="space-y-2">
            {byClient.map(([name, amount]) => {
              const pct = maxBarValue > 0 ? (amount / maxBarValue) * 100 : 0
              return (
                <div key={name} className="flex items-center gap-3">
                  <span className="text-xs w-40 text-right text-dark/60 shrink-0 truncate" title={name}>{name}</span>
                  <div className="flex-1 bg-light rounded-full h-5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-green-500/70 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs w-28 text-dark/70 shrink-0">{formatCurrency(amount)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={filterActive}
          onChange={e => setFilterActive(e.target.value as 'all' | 'active' | 'inactive')}
          className="px-3 py-2 border border-light rounded-md text-sm"
        >
          <option value="all">Всички</option>
          <option value="active">Активни</option>
          <option value="inactive">Неактивни</option>
        </select>
        <input
          type="number"
          placeholder="Мин. сума"
          value={filterAmountMin}
          onChange={e => setFilterAmountMin(e.target.value)}
          className="px-3 py-2 border border-light rounded-md text-sm w-28"
        />
        <input
          type="number"
          placeholder="Макс. сума"
          value={filterAmountMax}
          onChange={e => setFilterAmountMax(e.target.value)}
          className="px-3 py-2 border border-light rounded-md text-sm w-28"
        />
        {(filterActive !== 'active' || filterAmountMin || filterAmountMax) && (
          <button
            onClick={() => { setFilterActive('active'); setFilterAmountMin(''); setFilterAmountMax('') }}
            className="text-xs text-dark/40 hover:text-dark underline"
          >
            Изчисти филтри
          </button>
        )}
      </div>

      {/* Subscriptions Table */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-light bg-light/50">
              <th className="px-4 py-3 text-left cursor-pointer select-none" onClick={() => handleSort('client')}>
                Клиент{sortIcon('client')}
              </th>
              <th className="px-4 py-3 text-right cursor-pointer select-none" onClick={() => handleSort('amount')}>
                Сума{sortIcon('amount')}
              </th>
              <th className="px-4 py-3 text-center">Валута</th>
              <th className="px-4 py-3 text-center">Период</th>
              <th className="px-4 py-3 text-center">Активен</th>
              <th className="px-4 py-3 text-left">Бележки</th>
              {canEdit && <th className="px-4 py-3 text-right">Действия</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={canEdit ? 7 : 6} className="px-4 py-8 text-center text-dark/40">Няма абонаменти</td></tr>
            )}
            {filtered.map(sub => (
              <tr key={sub.id} className={`border-b border-light/50 hover:bg-light/30 transition ${!sub.is_active ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3 font-medium">{clientName(sub.client_id)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(sub.amount, sub.currency)}</td>
                <td className="px-4 py-3 text-center text-dark/50">{sub.currency}</td>
                <td className="px-4 py-3 text-center">
                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-navy/10 text-navy">
                    {PERIOD_LABELS[sub.payment_period] ?? sub.payment_period}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  {canEdit ? (
                    <button
                      onClick={() => handleToggleActive(sub)}
                      className={`text-xs px-2 py-1 rounded ${sub.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                    >
                      {sub.is_active ? '✓ Да' : '✕ Не'}
                    </button>
                  ) : (
                    <span className={sub.is_active ? 'text-green-600' : 'text-red-500'}>
                      {sub.is_active ? '✓' : '✕'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-dark/70 max-w-[200px] truncate" title={sub.notes ?? ''}>{sub.notes || '—'}</td>
                {canEdit && (
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => { setEditing(sub); setShowForm(true) }} className="text-xs text-navy hover:underline mr-2">✏️</button>
                    {isAdmin && (
                      <button onClick={() => handleDelete(sub)} className="text-xs text-red-500 hover:underline">🗑️</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Clients with Honorar */}
      <div className="mt-8">
        <h2 className="text-lg font-bold text-navy mb-3">👥 Клиенти с хонорар</h2>
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-navy/5 text-dark/70">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Клиент</th>
                <th className="text-right px-4 py-2 font-medium">Хонорар</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-light">
              {(() => {
                const honorarCol = columns.find(c => c.name === 'Хонорар')
                if (!honorarCol) return (
                  <tr><td colSpan={2} className="px-4 py-3 text-center text-dark/40">Няма колона Хонорар</td></tr>
                )
                const rows = clients.map(client => {
                  const nameCell = cellValues.find(cv => cv.client_id === client.id && columns.find(c => c.id === cv.column_id && c.type === 'text'))
                  const name = nameCell?.value_text || clientName(client.id)
                  const hCell = cellValues.find(cv => cv.client_id === client.id && cv.column_id === honorarCol.id)
                  const amount = hCell?.value_number ?? 0
                  return { id: client.id, name, amount }
                }).filter(r => r.amount > 0).sort((a, b) => b.amount - a.amount)
                if (rows.length === 0) return (
                  <tr><td colSpan={2} className="px-4 py-3 text-center text-dark/40">Няма клиенти с хонорар</td></tr>
                )
                return rows.map(r => (
                  <tr key={r.id} className="hover:bg-navy/5">
                    <td className="px-4 py-2">{r.name}</td>
                    <td className="px-4 py-2 text-right font-medium">{r.amount.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} €</td>
                  </tr>
                ))
              })()}
            </tbody>
            <tfoot className="bg-navy/5 border-t border-light">
              <tr>
                <td className="px-4 py-2 font-bold">Общо</td>
                <td className="px-4 py-2 text-right font-bold">
                  {(() => {
                    const honorarCol = columns.find(c => c.name === 'Хонорар')
                    if (!honorarCol) return '0.00 €'
                    const total = clients.reduce((sum, client) => {
                      const hCell = cellValues.find(cv => cv.client_id === client.id && cv.column_id === honorarCol.id)
                      return sum + (hCell?.value_number ?? 0)
                    }, 0)
                    return `${total.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} €`
                  })()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <SubscriptionForm
          subscription={editing}
          clients={clients}
          clientNameFn={clientName}
          userId={user?.id}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditing(null) }}
        />
      )}
    </div>
  )
}

// ==================== SUBSCRIPTION FORM MODAL ====================

function SubscriptionForm({ subscription, clients, clientNameFn, userId, onSave, onClose }: {
  subscription: Subscription | null
  clients: Client[]
  clientNameFn: (id: string) => string
  userId?: string
  onSave: (data: Omit<Subscription, 'id' | 'created_at' | 'updated_at'>) => void
  onClose: () => void
}) {
  const [clientId, setClientId] = useState(subscription?.client_id ?? '')
  const [amount, setAmount] = useState(subscription?.amount?.toString() ?? '')
  const [currency, setCurrency] = useState(subscription?.currency ?? 'EUR')
  const [paymentPeriod, setPaymentPeriod] = useState(subscription?.payment_period ?? 'monthly')
  const [notes, setNotes] = useState(subscription?.notes ?? '')
  const [isActive, setIsActive] = useState(subscription?.is_active ?? true)

  // Sort clients by name for dropdown
  const sortedClients = useMemo(() =>
    [...clients].sort((a, b) => clientNameFn(a.id).localeCompare(clientNameFn(b.id))),
    [clients, clientNameFn]
  )

  function handleSubmit() {
    const amt = parseFloat(amount)
    if (!clientId || isNaN(amt) || amt <= 0) return
    onSave({
      client_id: clientId,
      amount: amt,
      currency,
      payment_period: paymentPeriod,
      notes: notes.trim() || null,
      is_active: isActive,
      created_by: subscription?.created_by ?? userId ?? null,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-navy mb-4">
          {subscription ? 'Редактирай абонамент' : 'Нов абонамент'}
        </h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Клиент *</label>
            <select value={clientId} onChange={e => setClientId(e.target.value)}
              className="w-full px-3 py-2 border border-light rounded-md">
              <option value="">— Избери клиент —</option>
              {sortedClients.map(c => (
                <option key={c.id} value={c.id}>{clientNameFn(c.id)}</option>
              ))}
            </select>
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
            <label className="block text-sm font-medium text-dark mb-1">Период на плащане</label>
            <select value={paymentPeriod} onChange={e => setPaymentPeriod(e.target.value)}
              className="w-full px-3 py-2 border border-light rounded-md">
              <option value="monthly">Месечно</option>
              <option value="quarterly">Тримесечно</option>
              <option value="yearly">Годишно</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Бележки</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Допълнителна информация..."
              className="w-full px-3 py-2 border border-light rounded-md focus:outline-none focus:ring-2 focus:ring-navy" />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)}
              className="rounded border-light" />
            Активен абонамент
          </label>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 border border-light rounded-md text-sm hover:bg-light transition">
            Отказ
          </button>
          <button onClick={handleSubmit}
            className="px-4 py-2 bg-navy text-white rounded-md hover:bg-navy-light transition text-sm font-medium">
            {subscription ? 'Запази' : 'Добави'}
          </button>
        </div>
      </div>
    </div>
  )
}
