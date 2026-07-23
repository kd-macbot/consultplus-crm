import { useMemo } from 'react'
import { KanbanSquare, ShieldAlert, CalendarDays, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useClients, useColumns, useCellValues, useDropdownOptions, useStaff, useTasks } from '../../lib/queries'
import { useMyStaff } from '../../lib/useMyStaff'
import {
  INSPECTION_TYPE_COLORS, INSPECTION_TYPE_LABELS,
  TASK_STATUS_COLORS, TASK_STATUS_LABELS,
  type InspectionType, type Task, type TaskStatus,
} from '../../lib/types'
import { formatDate, namesMatch } from '../../lib/utils'

// ============================================================
// Статистика Задачи/Ревизии за Таблото.
//  - MyTasksCard: личните задачи/проверки (всички роли)
//  - TeamTasksCards: екипен поглед (само admin/manager)
// Чисто четене от споделения кеш — без собствени заявки освен useTasks.
// ============================================================

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysUntil(dateIso: string): number {
  return Math.round((new Date(dateIso).getTime() - new Date(todayIso()).getTime()) / 86_400_000)
}

function DueBadge({ due }: { due: string }) {
  const d = daysUntil(due)
  const label = d < 0 ? `${-d} дн. просрочка` : d === 0 ? 'днес' : `още ${d} дн.`
  const cls = d < 0 ? 'text-red-600 font-semibold' : d <= 3 ? 'text-amber-600 font-medium' : 'text-muted-foreground'
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] whitespace-nowrap ${cls}`}>
      <CalendarDays className="h-3 w-3" />
      {formatDate(due)} · {label}
    </span>
  )
}

function StatusChips({ tasks }: { tasks: Task[] }) {
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    tasks.forEach(t => m.set(t.status, (m.get(t.status) ?? 0) + 1))
    return m
  }, [tasks])
  return (
    <div className="flex flex-wrap gap-1.5">
      {(['issue', 'in_progress', 'todo'] as TaskStatus[]).map(s => {
        const n = counts.get(s) ?? 0
        if (n === 0) return null
        return (
          <span key={s} className={`px-2 py-0.5 rounded border text-[11px] font-medium ${TASK_STATUS_COLORS[s]}`}>
            {TASK_STATUS_LABELS[s]}: {n}
          </span>
        )
      })}
    </div>
  )
}

/** Споделените derive-и: имена на фирми + отговорници (от EAV кеша). */
function useClientLookups() {
  const clientsQ = useClients()
  const columnsQ = useColumns()
  const cellsQ = useCellValues()
  const dropdownsQ = useDropdownOptions()
  const columns = columnsQ.data ?? []
  const cells = cellsQ.data ?? []
  const dropdowns = dropdownsQ.data ?? []

  const nameByClient = useMemo(() => {
    const nameColId = [...columns].sort((a, b) => a.position - b.position).find(c => c.type === 'text')?.id
    const m = new Map<string, string>()
    if (!nameColId) return m
    cells.forEach(c => { if (c.column_id === nameColId && c.value_text) m.set(c.client_id, c.value_text) })
    return m
  }, [columns, cells])

  const respByClient = useMemo(() => {
    const respCol = columns.find(c => c.name === 'Отговорник')
    const dropVal = new Map(dropdowns.map(d => [d.id, d.value]))
    const m = new Map<string, string>()
    if (!respCol) return m
    cells.forEach(c => {
      if (c.column_id !== respCol.id) return
      const v = c.value_text || (c.value_dropdown ? dropVal.get(c.value_dropdown) : '')
      if (v) m.set(c.client_id, v)
    })
    return m
  }, [columns, cells, dropdowns])

  const ready = !!clientsQ.data && !!columnsQ.data && !!cellsQ.data && !!dropdownsQ.data
  return { nameByClient, respByClient, ready }
}

// ============================================================
// Лична карта — за всички роли
// ============================================================
export function MyTasksCard() {
  const tasksQ = useTasks()
  const { myStaff } = useMyStaff()
  const { nameByClient, respByClient } = useClientLookups()

  const all = tasksQ.data ?? []

  const myTasks = useMemo(() =>
    myStaff
      ? all.filter(t => (t.kind ?? 'task') === 'task' && t.status !== 'done' && t.assignee_staff_id === myStaff.id)
      : [],
    [all, myStaff])

  const myInspections = useMemo(() =>
    myStaff
      ? all.filter(t => t.kind === 'inspection' && t.status !== 'done'
          && t.client_id && namesMatch(respByClient.get(t.client_id), myStaff.full_name))
      : [],
    [all, myStaff, respByClient])

  // Топ 5 по спешност: просрочените първи, после по наближаващ срок; без срок — накрая.
  const urgent = useMemo(() => {
    const withRank = [...myTasks, ...myInspections]
    return withRank.sort((a, b) => {
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
      if (a.due_date) return -1
      if (b.due_date) return 1
      return 0
    }).slice(0, 5)
  }, [myTasks, myInspections])

  if (!myStaff || (myTasks.length === 0 && myInspections.length === 0)) return null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between px-5 pt-5 pb-3">
        <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
          <KanbanSquare className="h-4 w-4 text-muted-foreground" />
          Моите задачи
        </CardTitle>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>задачи: <strong className="text-foreground">{myTasks.length}</strong></span>
          {myInspections.length > 0 && (
            <span>проверки: <strong className="text-foreground">{myInspections.length}</strong></span>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-2">
        <StatusChips tasks={[...myTasks, ...myInspections]} />
        <div className="divide-y divide-border">
          {urgent.map(t => (
            <div key={t.id} className="py-1.5 flex items-center justify-between gap-3 text-sm">
              <div className="truncate">
                <span className="font-medium text-foreground">{t.title}</span>
                {t.client_id && nameByClient.get(t.client_id) && (
                  <span className="text-muted-foreground text-xs ml-1.5">{nameByClient.get(t.client_id)}</span>
                )}
              </div>
              {t.due_date ? <DueBadge due={t.due_date} /> : <span className="text-xs text-muted-foreground/40">без срок</span>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================
// Екипни карти — само admin/manager
// ============================================================
export function TeamTasksCards() {
  const tasksQ = useTasks()
  const staffQ = useStaff()
  const { nameByClient } = useClientLookups()

  const all = tasksQ.data ?? []
  const staffById = useMemo(() => new Map((staffQ.data ?? []).map(s => [s.id, s.full_name])), [staffQ.data])

  // --- Ревизии ---
  const openInspections = useMemo(() => all.filter(t => t.kind === 'inspection' && t.status !== 'done'), [all])
  const upcoming = useMemo(() =>
    openInspections
      .filter(t => t.due_date && daysUntil(t.due_date) <= 14)
      .sort((a, b) => a.due_date!.localeCompare(b.due_date!))
      .slice(0, 6),
    [openInspections])
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>()
    openInspections.forEach(t => { const k = t.inspection_type ?? 'друго'; m.set(k, (m.get(k) ?? 0) + 1) })
    return [...m.entries()]
  }, [openInspections])

  // --- Задачи ---
  const openTasks = useMemo(() => all.filter(t => (t.kind ?? 'task') === 'task' && t.status !== 'done'), [all])
  const overdueTasks = useMemo(() =>
    openTasks.filter(t => t.due_date && daysUntil(t.due_date) < 0)
      .sort((a, b) => a.due_date!.localeCompare(b.due_date!))
      .slice(0, 5),
    [openTasks])
  const byAssignee = useMemo(() => {
    const m = new Map<string, number>()
    openTasks.forEach(t => {
      if (!t.assignee_staff_id) return
      m.set(t.assignee_staff_id, (m.get(t.assignee_staff_id) ?? 0) + 1)
    })
    return [...m.entries()]
      .map(([id, n]) => ({ name: staffById.get(id) ?? '—', n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 5)
  }, [openTasks, staffById])
  const doneLast30 = useMemo(() => {
    const cutoff = Date.now() - 30 * 86_400_000
    return all.filter(t => t.status === 'done' && new Date(t.updated_at).getTime() >= cutoff).length
  }, [all])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
      {/* Ревизии */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between px-5 pt-5 pb-3">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            Ревизии и проверки
          </CardTitle>
          <span className="text-xs text-muted-foreground">активни: <strong className="text-foreground">{openInspections.length}</strong></span>
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-3">
          <StatusChips tasks={openInspections} />
          {typeCounts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {typeCounts.map(([type, n]) => (
                <span key={type} className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${INSPECTION_TYPE_COLORS[type as InspectionType] ?? 'bg-muted text-foreground border-border'}`}>
                  {INSPECTION_TYPE_LABELS[type as InspectionType] ?? type}: {n}
                </span>
              ))}
            </div>
          )}
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Наближаващи предавания (14 дни)</p>
            {upcoming.length === 0 ? (
              <p className="text-xs text-muted-foreground/60">Няма наближаващи срокове. 🎉</p>
            ) : (
              <div className="divide-y divide-border">
                {upcoming.map(t => (
                  <div key={t.id} className="py-1.5 flex items-center justify-between gap-3 text-sm">
                    <div className="truncate">
                      <span className="font-medium text-foreground">{t.client_id ? nameByClient.get(t.client_id) ?? t.title : t.title}</span>
                      <span className="text-muted-foreground text-xs ml-1.5">{INSPECTION_TYPE_LABELS[t.inspection_type as InspectionType] ?? t.inspection_type}</span>
                    </div>
                    <DueBadge due={t.due_date!} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Задачи (екип) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between px-5 pt-5 pb-3">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <KanbanSquare className="h-4 w-4 text-muted-foreground" />
            Задачи (екип)
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            отворени: <strong className="text-foreground">{openTasks.length}</strong>
            <span className="mx-1.5">·</span>
            готови 30 дни: <strong className="text-emerald-600">{doneLast30}</strong>
          </span>
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-3">
          <StatusChips tasks={openTasks} />
          {overdueTasks.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-red-600 font-semibold mb-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Просрочени
              </p>
              <div className="divide-y divide-border">
                {overdueTasks.map(t => (
                  <div key={t.id} className="py-1.5 flex items-center justify-between gap-3 text-sm">
                    <div className="truncate">
                      <span className="font-medium text-foreground">{t.title}</span>
                      {t.assignee_staff_id && (
                        <span className="text-muted-foreground text-xs ml-1.5">{staffById.get(t.assignee_staff_id)}</span>
                      )}
                    </div>
                    <DueBadge due={t.due_date!} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {byAssignee.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">По изпълнител</p>
              <div className="space-y-1">
                {byAssignee.map(a => (
                  <div key={a.name} className="flex items-center gap-2 text-xs">
                    <span className="w-40 truncate text-foreground">{a.name}</span>
                    <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                      <div className="h-full bg-primary/60" style={{ width: `${(a.n / (byAssignee[0]?.n || 1)) * 100}%` }} />
                    </div>
                    <span className="w-6 text-right tabular-nums text-muted-foreground">{a.n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
