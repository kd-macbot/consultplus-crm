import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import { getExpenses, getMonthlyWork, getTrzWork } from '../lib/storage'
import { useClients, useColumns, useCellValues, useDropdownOptions } from '../lib/queries'
import { supabase } from '../lib/supabase'
import type { Column, Expense } from '../lib/types'
import { buildCellIndex, buildDropdownIndex, cellKey, resolveDropdownText } from '../lib/tableIndices'
import { isHiddenStatus } from '../lib/statusBadge'
import { Users, Euro, CheckCircle2, TrendingUp, TrendingDown, Wallet, BookUser, ChevronLeft, ChevronRight, ClipboardCheck, AlertTriangle, Receipt } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn, formatCurrency, MONTH_NAMES } from '@/lib/utils'
import { TRZ_ACTIVE, findTrzColumns, computeTrzProgress } from '../lib/trz'

export function Dashboard() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isRestricted = user?.role === 'manager' || user?.role === 'employee'

  // Споделените данни идват от React Query кеша — навигацията между страници
  // не ги презарежда (staleTime 30s), а retry-ът е в storage слоя.
  const clientsQ = useClients()
  const columnsQ = useColumns()
  const cellsQ = useCellValues()
  const dropdownsQ = useDropdownOptions()
  const contactsCountQ = useQuery({
    queryKey: ['contactsCount'],
    queryFn: async () => {
      const { count } = await supabase.from('crm_contacts').select('*', { count: 'exact', head: true })
      return count ?? 0
    },
  })
  const expensesQ = useQuery({
    queryKey: ['expenses'],
    queryFn: getExpenses,
    enabled: isAdmin,
  })

  const now = new Date()
  const [wsYear, setWsYear] = useState(now.getFullYear())
  const [wsMonth, setWsMonth] = useState(now.getMonth() + 1)
  const monthlyWorkQ = useQuery({
    queryKey: ['monthlyWork', wsYear, wsMonth],
    queryFn: () => getMonthlyWork(wsYear, wsMonth),
  })

  const [trzYear, setTrzYear] = useState(now.getFullYear())
  const [trzMonth, setTrzMonth] = useState(now.getMonth() + 1)
  const trzWorkQ = useQuery({
    queryKey: ['trzWork', trzYear, trzMonth],
    queryFn: () => getTrzWork(trzYear, trzMonth),
  })

  function shiftMonth(delta: number) {
    let m = wsMonth + delta
    let y = wsYear
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setWsMonth(m)
    setWsYear(y)
  }

  function shiftTrzMonth(delta: number) {
    let m = trzMonth + delta
    let y = trzYear
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setTrzMonth(m)
    setTrzYear(y)
  }

  const loading = clientsQ.isLoading || columnsQ.isLoading || cellsQ.isLoading || dropdownsQ.isLoading

  // Месечни статистики от Работния лист. Служителите виждат само своите клиенти.
  const wsStats = useMemo(() => {
    const clients = clientsQ.data ?? []
    const columns = columnsQ.data ?? []
    const cells = cellsQ.data ?? []
    const dropdowns = dropdownsQ.data ?? []
    const work = monthlyWorkQ.data ?? []

    const cellIdx = buildCellIndex(cells)
    const dropdownIdx = buildDropdownIndex(dropdowns)
    const statusCol = columns.find((c: Column) => c.name === 'Статус')
    const workByClient = new Map(work.map(w => [w.client_id, w]))

    const visible = user?.role === 'employee'
      ? clients.filter(c => c.assigned_to === user.id)
      : clients
    const active = visible.filter(c => !isHiddenStatus(resolveDropdownText(c.id, statusCol, cellIdx, dropdownIdx)))

    let submitted = 0, notified = 0, vat = 0, amort = 0, bank = 0, salaries = 0, npa = 0, resultSum = 0
    for (const c of active) {
      const w = workByClient.get(c.id)
      if (!w) continue
      if (w.submitted_at) submitted++
      if (w.notification_method) notified++
      if (w.vat_accounted) vat++
      if (w.amortization_done) amort++
      if (w.bank_done) bank++
      if (w.salaries_done) salaries++
      if (w.npa_inconsistencies && w.npa_inconsistencies.trim()) npa++
      if (typeof w.result_amount === 'number') resultSum += w.result_amount
    }
    return { total: active.length, submitted, notified, vat, amort, bank, salaries, npa, resultSum }
  }, [clientsQ.data, columnsQ.data, cellsQ.data, dropdownsQ.data, monthlyWorkQ.data, user])

  // ТРЗ месечен напредък — „общо" = фирмите с ТРЗ Статус = „Активна".
  const trzStats = useMemo(() => {
    const clients = clientsQ.data ?? []
    const columns = columnsQ.data ?? []
    const cells = cellsQ.data ?? []
    const dropdowns = dropdownsQ.data ?? []
    const work = trzWorkQ.data ?? []

    const cellIdx = buildCellIndex(cells)
    const dropdownIdx = buildDropdownIndex(dropdowns)
    const trzStatusCol = findTrzColumns(columns).status
    const workByClient = new Map(work.map(w => [w.client_id, w]))

    const activeIds = clients
      .filter(c => resolveDropdownText(c.id, trzStatusCol, cellIdx, dropdownIdx) === TRZ_ACTIVE)
      .map(c => c.id)
    return computeTrzProgress(activeIds, workByClient)
  }, [clientsQ.data, columnsQ.data, cellsQ.data, dropdownsQ.data, trzWorkQ.data])

  const stats = useMemo(() => {
    const clients = clientsQ.data ?? []
    const columns = columnsQ.data ?? []
    const cells = cellsQ.data ?? []
    const dropdowns = dropdownsQ.data ?? []
    const contactsCount = contactsCountQ.data ?? 0
    const exps = (expensesQ.data ?? []) as Expense[]

    const cellIdx = buildCellIndex(cells)
    const dropdownIdx = buildDropdownIndex(dropdowns)

    const statusCol = columns.find((c: Column) => c.name === 'Статус')
    const statusCounts: Record<string, number> = {}

    if (statusCol) {
      for (const client of clients) {
        const cell = cellIdx.get(cellKey(client.id, statusCol.id))
        const label = cell?.value_dropdown ? (dropdownIdx.get(cell.value_dropdown)?.value || 'N/A') : 'N/A'
        statusCounts[label] = (statusCounts[label] || 0) + 1
      }
    }

    const honorarCol = columns.find((c: Column) => c.name === 'Хонорар')
    const accountantCol = columns.find((c: Column) => c.name === 'Счетоводител')
    let totalHonorar = 0
    const honorarByAccountant: Record<string, { sum: number; count: number }> = {}
    const honorarByStatus: Record<string, number> = {}

    if (isAdmin) {
      for (const client of clients) {
        const hCell = honorarCol ? cellIdx.get(cellKey(client.id, honorarCol.id)) : null
        const amount = hCell?.value_number && hCell.value_number > 0 ? hCell.value_number : 0
        totalHonorar += amount

        if (accountantCol) {
          const aCell = cellIdx.get(cellKey(client.id, accountantCol.id))
          const name = aCell?.value_text || 'Без счетоводител'
          if (!honorarByAccountant[name]) honorarByAccountant[name] = { sum: 0, count: 0 }
          honorarByAccountant[name].sum += amount
          honorarByAccountant[name].count++
        }

        if (statusCol) {
          const sCell = cellIdx.get(cellKey(client.id, statusCol.id))
          const statusLabel = sCell?.value_dropdown ? (dropdownIdx.get(sCell.value_dropdown)?.value ?? 'N/A') : 'N/A'
          honorarByStatus[statusLabel] = (honorarByStatus[statusLabel] || 0) + amount
        }
      }
    }

    const monthlyExpenses = exps.reduce((sum: number, e: Expense) => sum + e.amount, 0)

    return { total: clients.length, contactsCount, statusCounts, totalHonorar, honorarByAccountant, honorarByStatus, monthlyExpenses }
  }, [clientsQ.data, columnsQ.data, cellsQ.data, dropdownsQ.data, contactsCountQ.data, expensesQ.data, isAdmin])

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

  const worksheetSection = (
    <>
      {/* Работен лист — месечен напредък (всички роли) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between px-5 pt-5 pb-3">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-navy" />
            Работен лист
            {user?.role === 'employee' && <span className="text-xs font-normal text-muted-foreground">(моите клиенти)</span>}
          </CardTitle>
          <div className="flex items-center gap-1">
            <button onClick={() => shiftMonth(-1)} aria-label="Предходен месец"
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium text-foreground min-w-[130px] text-center">{MONTH_NAMES[wsMonth - 1]} {wsYear}</span>
            <button onClick={() => shiftMonth(1)} aria-label="Следващ месец"
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {monthlyWorkQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Зареждане...</p>
          ) : wsStats.total === 0 ? (
            <p className="text-sm text-muted-foreground">Няма активни клиенти за този месец.</p>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Подадени</p>
                  <p className="text-2xl font-bold text-foreground tabular-nums">
                    {wsStats.submitted}<span className="text-base text-muted-foreground font-normal"> / {wsStats.total}</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Уведомени</p>
                  <p className="text-2xl font-bold text-foreground tabular-nums">
                    {wsStats.notified}<span className="text-base text-muted-foreground font-normal"> / {wsStats.total}</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">ДДС осчетоводено</p>
                  <p className="text-2xl font-bold text-foreground tabular-nums">
                    {wsStats.vat}<span className="text-base text-muted-foreground font-normal"> / {wsStats.total}</span>
                  </p>
                </div>
                {wsStats.npa > 0 && (
                  <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">{wsStats.npa} с несъответствия НАП</span>
                  </div>
                )}
              </div>

              <div className="space-y-2.5">
                <WsProgress label="Подадени" done={wsStats.submitted} total={wsStats.total} />
                <WsProgress label="Уведомени" done={wsStats.notified} total={wsStats.total} />
                <WsProgress label="ДДС осчетоводено" done={wsStats.vat} total={wsStats.total} />
                <WsProgress label="Амортизации" done={wsStats.amort} total={wsStats.total} />
                <WsProgress label="Банка" done={wsStats.bank} total={wsStats.total} />
                <WsProgress label="Заплати" done={wsStats.salaries} total={wsStats.total} />
              </div>

              <div className="text-sm text-muted-foreground">
                Сумарен резултат за месеца: <span className="font-semibold text-foreground">{formatCurrency(wsStats.resultSum)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ТРЗ Работен лист — месечен напредък (всички роли) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between px-5 pt-5 pb-3">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <Receipt className="h-4 w-4 text-navy" />
            ТРЗ Работен лист
          </CardTitle>
          <div className="flex items-center gap-1">
            <button onClick={() => shiftTrzMonth(-1)} aria-label="Предходен месец"
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium text-foreground min-w-[130px] text-center">{MONTH_NAMES[trzMonth - 1]} {trzYear}</span>
            <button onClick={() => shiftTrzMonth(1)} aria-label="Следващ месец"
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {trzWorkQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Зареждане...</p>
          ) : trzStats.total === 0 ? (
            <p className="text-sm text-muted-foreground">Няма активни фирми за ТРЗ.</p>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Заплати</p>
                  <p className="text-2xl font-bold text-foreground tabular-nums">
                    {trzStats.salaries}<span className="text-base text-muted-foreground font-normal"> / {trzStats.total}</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Осигуровки</p>
                  <p className="text-2xl font-bold text-foreground tabular-nums">
                    {trzStats.insurance}<span className="text-base text-muted-foreground font-normal"> / {trzStats.total}</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Ведомост</p>
                  <p className="text-2xl font-bold text-foreground tabular-nums">
                    {trzStats.payroll}<span className="text-base text-muted-foreground font-normal"> / {trzStats.total}</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Напълно готови</p>
                  <p className="text-2xl font-bold text-green-600 tabular-nums">
                    {trzStats.fullyDone}<span className="text-base text-muted-foreground font-normal"> / {trzStats.total}</span>
                  </p>
                </div>
              </div>

              <div className="space-y-2.5">
                <WsProgress label="Изготвени заплати" done={trzStats.salaries} total={trzStats.total} />
                <WsProgress label="Подадени осигуровки" done={trzStats.insurance} total={trzStats.total} />
                <WsProgress label="Изпратена ведомост" done={trzStats.payroll} total={trzStats.total} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground">
          Здравей, {user?.full_name} 👋
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{user ? roleLabel[user.role] : ''}</p>
      </div>

      {/* Работни листове — за админ са най-отдолу, за останалите тук горе */}
      {!isAdmin && worksheetSection}

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
                <p className="text-3xl font-bold text-foreground">{stats.total}</p>
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
                <p className="text-3xl font-bold text-foreground">{stats.contactsCount}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="px-5 pt-5 pb-3">
              <CardTitle className="text-base font-semibold text-foreground">Клиенти по статус</CardTitle>
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
                <p className="text-3xl font-bold text-foreground">{stats.total}</p>
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
                <p className="text-3xl font-bold text-foreground">{stats.contactsCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-medium text-muted-foreground">Общ хонорар</CardTitle>
                <Euro className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <p className="text-3xl font-bold text-gold">{formatCurrency(stats.totalHonorar)}</p>
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
                  {formatCurrency(stats.totalHonorar)}
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
                  {formatCurrency(stats.monthlyExpenses)}
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
                  {formatCurrency(profit)}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Clients by status */}
            <Card>
              <CardHeader className="px-5 pt-5 pb-3">
                <CardTitle className="text-base font-semibold text-foreground">Клиенти по статус</CardTitle>
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
                <CardTitle className="text-base font-semibold text-foreground">Хонорар по статус</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <div className="space-y-3">
                  {Object.entries(stats.honorarByStatus).sort((a, b) => b[1] - a[1]).map(([status, sum]) => (
                    <div key={status} className="flex items-center gap-3">
                      <div className="w-28 text-sm text-muted-foreground truncate">{status}</div>
                      <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                        <div className="h-full bg-gold rounded-full transition-all" style={{ width: `${stats.totalHonorar > 0 ? (sum / stats.totalHonorar) * 100 : 0}%` }} />
                      </div>
                      <div className="w-20 text-sm text-right font-semibold">{formatCurrency(sum)}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Honorar by accountant */}
          <Card>
            <CardHeader className="px-5 pt-5 pb-3">
              <CardTitle className="text-base font-semibold text-foreground">Хонорар по счетоводител</CardTitle>
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
                          <span className="text-[10px] text-white font-medium">{formatCurrency(sum)}</span>
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

      {/* За админа работните листове са най-отдолу, под другите карти */}
      {isAdmin && worksheetSection}
    </div>
  )
}

function WsProgress({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total > 0 ? (done / total) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <div className="w-36 text-sm text-muted-foreground truncate">{label}</div>
      <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
        <div className="h-full bg-navy rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="w-16 text-sm text-right font-semibold tabular-nums">{done}/{total}</div>
    </div>
  )
}
