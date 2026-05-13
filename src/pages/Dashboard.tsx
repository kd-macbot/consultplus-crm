import { useState, useEffect } from 'react'
import { useAuth } from '../lib/auth'
import { getClients, getCellValues, getColumns, getDropdownOptions, getExpenses } from '../lib/storage'
import { supabase } from '../lib/supabase'
import type { Client, Column, CellValue, DropdownOption, Expense } from '../lib/types'
import { Users, Euro, CheckCircle2, TrendingUp, TrendingDown, Wallet, BookUser } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function Dashboard() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isRestricted = user?.role === 'manager' || user?.role === 'employee'

  const [stats, setStats] = useState({
    total: 0,
    contactsCount: 0,
    statusCounts: {} as Record<string, number>,
    totalHonorar: 0,
    honorarByAccountant: {} as Record<string, { sum: number; count: number }>,
    honorarByStatus: {} as Record<string, number>,
    monthlyExpenses: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadStats() }, [])

  async function loadStats() {
    try {
      let clients: Client[] = []
      let columns: Column[] = []
      let cells: CellValue[] = []
      let dropdowns: DropdownOption[] = []
      let exps: Expense[] = []
      let contactsCount = 0

      try { clients = await getClients() } catch { /* */ }
      try { columns = await getColumns() } catch { /* */ }
      try { cells = await getCellValues() } catch { /* */ }
      try { dropdowns = await getDropdownOptions() } catch { /* */ }
      try {
        const { count } = await supabase
          .from('crm_contacts')
          .select('*', { count: 'exact', head: true })
        contactsCount = count ?? 0
      } catch { /* */ }
      if (isAdmin) {
        try { exps = await getExpenses() } catch { /* */ }
      }

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

      if (isAdmin) {
        for (const client of clients) {
          const hCell = honorarCol ? cells.find((cv: CellValue) => cv.client_id === client.id && cv.column_id === honorarCol.id) : null
          const amount = hCell?.value_number && hCell.value_number > 0 ? hCell.value_number : 0
          totalHonorar += amount

          if (accountantCol) {
            const aCell = cells.find((cv: CellValue) => cv.client_id === client.id && cv.column_id === accountantCol.id)
            const name = aCell?.value_text || 'Без счетоводител'
            if (!honorarByAccountant[name]) honorarByAccountant[name] = { sum: 0, count: 0 }
            honorarByAccountant[name].sum += amount
            honorarByAccountant[name].count++
          }

          if (statusCol) {
            const sCell = cells.find((cv: CellValue) => cv.client_id === client.id && cv.column_id === statusCol.id)
            let statusLabel = 'N/A'
            if (sCell?.value_dropdown) {
              const opt = dropdowns.find((d: DropdownOption) => d.id === sCell.value_dropdown)
              statusLabel = opt?.value ?? 'N/A'
            }
            honorarByStatus[statusLabel] = (honorarByStatus[statusLabel] || 0) + amount
          }
        }
      }

      const monthlyExpenses = exps.reduce((sum: number, e: Expense) => sum + e.amount, 0)

      setStats({ total: clients.length, contactsCount, statusCounts, totalHonorar, honorarByAccountant, honorarByStatus, monthlyExpenses })
    } catch (err) {
      console.error('Failed to load stats:', err)
    } finally {
      setLoading(false)
    }
  }

  const roleLabel: Record<string, string> = { admin: 'Администратор', manager: 'Мениджър', employee: 'Служител' }
  const profit = stats.totalHonorar - stats.monthlyExpenses

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        Зареждане...
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground">
          Здравей, {user?.full_name} 👋
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{user ? roleLabel[user.role] : ''}</p>
      </div>

      {/* Restricted view — manager & employee */}
      {isRestricted && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-medium text-muted-foreground">Общо клиенти</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <p className="text-3xl font-bold text-navy">{stats.total}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-medium text-muted-foreground">Активни</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <p className="text-3xl font-bold text-green-600">{stats.statusCounts['АКТИВНА'] ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-medium text-muted-foreground">Брой Контакти</CardTitle>
                <BookUser className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <p className="text-3xl font-bold text-navy">{stats.contactsCount}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="px-5 pt-5 pb-3">
              <CardTitle className="text-base font-semibold text-navy">Клиенти по статус</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <div className="space-y-3">
                {Object.entries(stats.statusCounts).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                  <div key={status} className="flex items-center gap-3">
                    <div className="w-28 text-sm text-muted-foreground truncate">{status}</div>
                    <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                      <div className="h-full bg-navy rounded-full transition-all" style={{ width: `${(count / stats.total) * 100}%` }} />
                    </div>
                    <div className="w-8 text-sm text-right font-semibold">{count}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Admin-only full view */}
      {isAdmin && (
        <>
          {/* Top stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-medium text-muted-foreground">Общо клиенти</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <p className="text-3xl font-bold text-navy">{stats.total}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-medium text-muted-foreground">Активни</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <p className="text-3xl font-bold text-green-600">{stats.statusCounts['АКТИВНА'] ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-medium text-muted-foreground">Брой Контакти</CardTitle>
                <BookUser className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <p className="text-3xl font-bold text-navy">{stats.contactsCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-medium text-muted-foreground">Общ хонорар</CardTitle>
                <Euro className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <p className="text-3xl font-bold text-gold">{stats.totalHonorar.toLocaleString('bg-BG')} €</p>
              </CardContent>
            </Card>
          </div>

          {/* Financial overview */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-medium text-muted-foreground">Приход (хонорари)</CardTitle>
                <TrendingUp className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <p className="text-2xl font-bold text-green-600">
                  {stats.totalHonorar.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} €
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-medium text-muted-foreground">Месечни разходи</CardTitle>
                <Wallet className="h-4 w-4 text-red-400" />
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <p className="text-2xl font-bold text-red-500">
                  {stats.monthlyExpenses.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} €
                </p>
              </CardContent>
            </Card>
            <Card className={cn(profit >= 0 ? 'border-green-200' : 'border-red-200')}>
              <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-medium text-muted-foreground">Печалба</CardTitle>
                <TrendingDown className={cn('h-4 w-4', profit >= 0 ? 'text-green-500' : 'text-red-500')} />
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <p className={cn('text-2xl font-bold', profit >= 0 ? 'text-green-600' : 'text-red-500')}>
                  {profit.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} €
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Clients by status */}
            <Card>
              <CardHeader className="px-5 pt-5 pb-3">
                <CardTitle className="text-base font-semibold text-navy">Клиенти по статус</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <div className="space-y-3">
                  {Object.entries(stats.statusCounts).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                    <div key={status} className="flex items-center gap-3">
                      <div className="w-28 text-sm text-muted-foreground truncate">{status}</div>
                      <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                        <div className="h-full bg-navy rounded-full transition-all" style={{ width: `${(count / stats.total) * 100}%` }} />
                      </div>
                      <div className="w-8 text-sm text-right font-semibold">{count}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Honorar by status */}
            <Card>
              <CardHeader className="px-5 pt-5 pb-3">
                <CardTitle className="text-base font-semibold text-navy">Хонорар по статус</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <div className="space-y-3">
                  {Object.entries(stats.honorarByStatus).sort((a, b) => b[1] - a[1]).map(([status, sum]) => (
                    <div key={status} className="flex items-center gap-3">
                      <div className="w-28 text-sm text-muted-foreground truncate">{status}</div>
                      <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                        <div className="h-full bg-gold rounded-full transition-all" style={{ width: `${stats.totalHonorar > 0 ? (sum / stats.totalHonorar) * 100 : 0}%` }} />
                      </div>
                      <div className="w-20 text-sm text-right font-semibold">{sum.toLocaleString('bg-BG')} €</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Honorar by accountant */}
          <Card>
            <CardHeader className="px-5 pt-5 pb-3">
              <CardTitle className="text-base font-semibold text-navy">Хонорар по счетоводител</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <div className="space-y-3">
                {Object.entries(stats.honorarByAccountant)
                  .sort((a, b) => b[1].sum - a[1].sum)
                  .map(([name, { sum, count }]) => (
                    <div key={name} className="flex items-center gap-3">
                      <div className="w-44 text-sm text-muted-foreground truncate" title={name}>{name}</div>
                      <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
                        <div
                          className="h-full bg-navy rounded-full transition-all flex items-center justify-end pr-2"
                          style={{ width: `${stats.totalHonorar > 0 ? Math.max((sum / stats.totalHonorar) * 100, 8) : 0}%` }}
                        >
                          <span className="text-[10px] text-white font-medium">{sum.toLocaleString('bg-BG')} €</span>
                        </div>
                      </div>
                      <div className="w-14 text-xs text-muted-foreground text-right">{count} кл.</div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
