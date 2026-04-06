import { useState, useEffect } from 'react'
import { useAuth } from '../lib/auth'
import { getClients, getCellValues, getColumns, getDropdownOptions, getSubscriptions, getExpenses } from '../lib/storage'
import type { Client, Column, CellValue, DropdownOption, Subscription, Expense } from '../lib/types'

export function Dashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState({
    total: 0,
    statusCounts: {} as Record<string, number>,
    totalHonorar: 0,
    honorarByAccountant: {} as Record<string, { sum: number; count: number }>,
    honorarByStatus: {} as Record<string, number>,
    monthlyRevenue: 0,
    monthlyExpenses: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStats()
  }, [])

  async function loadStats() {
    try {
      const [clients, columns, cells, dropdowns, subs, exps] = await Promise.all([
        getClients().catch(() => []),
        getColumns().catch(() => []),
        getCellValues().catch(() => []),
        getDropdownOptions().catch(() => []),
        getSubscriptions().catch(() => []),
        getExpenses().catch(() => []),
      ])

      const statusCol = columns.find((c: Column) => c.name === 'Статус')
      const statusCounts: Record<string, number> = {}
      
      if (statusCol) {
        for (const client of clients) {
          const cell = cells.find((cv: CellValue) => cv.client_id === client.id && cv.column_id === statusCol.id)
          if (cell?.value_dropdown) {
            const opt = dropdowns.find((d: DropdownOption) => d.id === cell.value_dropdown)
            const label = opt?.value || 'N/A'
            statusCounts[label] = (statusCounts[label] || 0) + 1
          } else {
            statusCounts['N/A'] = (statusCounts['N/A'] || 0) + 1
          }
        }
      }

      const honorarCol = columns.find((c: Column) => c.name === 'Хонорар')
      const accountantCol = columns.find((c: Column) => c.name === 'Счетоводител')
      let totalHonorar = 0
      const honorarByAccountant: Record<string, { sum: number; count: number }> = {}
      const honorarByStatus: Record<string, number> = {}

      for (const client of clients) {
        const hCell = honorarCol ? cells.find((cv: CellValue) => cv.client_id === client.id && cv.column_id === honorarCol.id) : null
        const amount = hCell?.value_number && hCell.value_number > 0 ? hCell.value_number : 0
        totalHonorar += amount

        // By accountant
        if (accountantCol) {
          const aCell = cells.find((cv: CellValue) => cv.client_id === client.id && cv.column_id === accountantCol.id)
          const name = aCell?.value_text || 'Без счетоводител'
          if (!honorarByAccountant[name]) honorarByAccountant[name] = { sum: 0, count: 0 }
          honorarByAccountant[name].sum += amount
          honorarByAccountant[name].count++
        }

        // By status
        if (statusCol) {
          const sCell = cells.find((cv: CellValue) => cv.client_id === client.id && cv.column_id === statusCol.id)
          let statusLabel = 'Без статус'
          if (sCell?.value_dropdown) {
            const opt = dropdowns.find((d: DropdownOption) => d.id === sCell.value_dropdown)
            if (opt) statusLabel = opt.value
            else statusLabel = 'N/A'
          } else {
            statusLabel = 'N/A'
          }
          honorarByStatus[statusLabel] = (honorarByStatus[statusLabel] || 0) + amount
        }
      }

      // Profit overview
      const monthlyRevenue = subs.filter((s: Subscription) => s.is_active).reduce((sum: number, s: Subscription) => {
        if (s.payment_period === 'monthly') return sum + s.amount
        if (s.payment_period === 'quarterly') return sum + s.amount / 3
        if (s.payment_period === 'yearly') return sum + s.amount / 12
        return sum + s.amount
      }, 0)
      const monthlyExpenses = exps.reduce((sum: number, e: Expense) => sum + e.amount, 0)

      setStats({ total: clients.length, statusCounts, totalHonorar, honorarByAccountant, honorarByStatus, monthlyRevenue, monthlyExpenses })
    } catch (err) {
      console.error('Failed to load stats:', err)
    } finally {
      setLoading(false)
    }
  }

  const roleLabel = { admin: 'Администратор', manager: 'Мениджър', employee: 'Служител' }

  if (loading) {
    return <div className="p-6 text-dark/50">Зареждане...</div>
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-navy mb-6">
        Здравей, {user?.full_name} 👋
      </h1>
      <p className="text-dark/50 mb-8">Роля: {user ? roleLabel[user.role] : ''}</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-navy">
          <p className="text-sm text-dark/50">Общо клиенти</p>
          <p className="text-3xl font-bold text-navy">{stats.total}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-gold">
          <p className="text-sm text-dark/50">Общ хонорар</p>
          <p className="text-3xl font-bold text-gold">{stats.totalHonorar.toLocaleString('bg-BG')} €</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-green-500">
          <p className="text-sm text-dark/50">Активни</p>
          <p className="text-3xl font-bold text-green-600">{stats.statusCounts['АКТИВНА'] ?? 0}</p>
        </div>
      </div>

      {/* Profit Overview */}
      {(user?.role === 'admin' || user?.role === 'manager') && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6 border-l-4 border-green-500">
            <p className="text-sm text-dark/50">Месечен приход (абонаменти)</p>
            <p className="text-3xl font-bold text-green-600">{stats.monthlyRevenue.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} €</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6 border-l-4 border-red-400">
            <p className="text-sm text-dark/50">Месечни разходи</p>
            <p className="text-3xl font-bold text-red-500">{stats.monthlyExpenses.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} €</p>
          </div>
          <div className={`bg-white rounded-lg shadow p-6 border-l-4 ${stats.monthlyRevenue - stats.monthlyExpenses >= 0 ? 'border-green-500' : 'border-red-500'}`}>
            <p className="text-sm text-dark/50">Месечна печалба</p>
            <p className={`text-3xl font-bold ${stats.monthlyRevenue - stats.monthlyExpenses >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {(stats.monthlyRevenue - stats.monthlyExpenses).toLocaleString('bg-BG', { minimumFractionDigits: 2 })} €
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* По статус */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-medium text-navy mb-4">Клиенти по статус</h2>
          <div className="space-y-2">
            {Object.entries(stats.statusCounts).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
              <div key={status} className="flex items-center gap-3">
                <div className="w-32 text-sm text-dark/70 truncate">{status}</div>
                <div className="flex-1 bg-light rounded-full h-4 overflow-hidden">
                  <div className="h-full bg-navy rounded-full transition-all" style={{ width: `${(count / stats.total) * 100}%` }} />
                </div>
                <div className="w-10 text-sm text-right font-medium">{count}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Хонорар по статус */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-medium text-navy mb-4">Хонорар по статус</h2>
          <div className="space-y-2">
            {Object.entries(stats.honorarByStatus).sort((a, b) => b[1] - a[1]).map(([status, sum]) => (
              <div key={status} className="flex items-center gap-3">
                <div className="w-32 text-sm text-dark/70 truncate">{status}</div>
                <div className="flex-1 bg-light rounded-full h-4 overflow-hidden">
                  <div className="h-full bg-gold rounded-full transition-all" style={{ width: `${stats.totalHonorar > 0 ? (sum / stats.totalHonorar) * 100 : 0}%` }} />
                </div>
                <div className="w-20 text-sm text-right font-medium">{sum.toLocaleString('bg-BG')} €</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Хонорар по счетоводител */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-medium text-navy mb-4">💼 Хонорар по счетоводител</h2>
        <div className="space-y-3">
          {Object.entries(stats.honorarByAccountant)
            .sort((a, b) => b[1].sum - a[1].sum)
            .map(([name, { sum, count }]) => (
              <div key={name} className="flex items-center gap-3">
                <div className="w-48 text-sm text-dark/70 truncate" title={name}>{name}</div>
                <div className="flex-1 bg-light rounded-full h-5 overflow-hidden">
                  <div
                    className="h-full bg-navy rounded-full transition-all flex items-center justify-end pr-2"
                    style={{ width: `${stats.totalHonorar > 0 ? Math.max((sum / stats.totalHonorar) * 100, 8) : 0}%` }}
                  >
                    <span className="text-[10px] text-white font-medium">{sum.toLocaleString('bg-BG')} €</span>
                  </div>
                </div>
                <div className="w-16 text-xs text-dark/40 text-right">{count} кл.</div>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
