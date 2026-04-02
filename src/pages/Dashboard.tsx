import { useState, useEffect } from 'react'
import { useAuth } from '../lib/auth'
import { getClients, getCellValues, getColumns, getDropdownOptions } from '../lib/storage'
import type { Client, Column, CellValue, DropdownOption } from '../lib/types'

export function Dashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState({ total: 0, statusCounts: {} as Record<string, number>, totalHonorar: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStats()
  }, [])

  async function loadStats() {
    try {
      const [clients, columns, cells, dropdowns] = await Promise.all([
        getClients(), getColumns(), getCellValues(), getDropdownOptions()
      ])

      const statusCol = columns.find((c: Column) => c.name === 'Статус')
      const statusCounts: Record<string, number> = {}
      
      if (statusCol) {
        for (const client of clients) {
          const cell = cells.find((cv: CellValue) => cv.client_id === client.id && cv.column_id === statusCol.id)
          if (cell?.value_dropdown) {
            const opt = dropdowns.find((d: DropdownOption) => d.id === cell.value_dropdown)
            const label = opt?.value || 'Неизвестен'
            statusCounts[label] = (statusCounts[label] || 0) + 1
          } else {
            statusCounts['Без статус'] = (statusCounts['Без статус'] || 0) + 1
          }
        }
      }

      const honorarCol = columns.find((c: Column) => c.name === 'Хонорар')
      let totalHonorar = 0
      if (honorarCol) {
        for (const client of clients) {
          const cell = cells.find((cv: CellValue) => cv.client_id === client.id && cv.column_id === honorarCol.id)
          if (cell?.value_number) totalHonorar += cell.value_number
        }
      }

      setStats({ total: clients.length, statusCounts, totalHonorar })
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

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-medium text-navy mb-4">По статус</h2>
        <div className="space-y-2">
          {Object.entries(stats.statusCounts).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
            <div key={status} className="flex items-center gap-3">
              <div className="w-32 text-sm text-dark/70 truncate">{status}</div>
              <div className="flex-1 bg-light rounded-full h-4 overflow-hidden">
                <div
                  className="h-full bg-navy rounded-full transition-all"
                  style={{ width: `${(count / stats.total) * 100}%` }}
                />
              </div>
              <div className="w-10 text-sm text-right font-medium">{count}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
