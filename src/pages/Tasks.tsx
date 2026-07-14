import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Archive, KanbanSquare, List, Plus, Search, Trash2, X, CalendarDays, User as UserIcon, ShieldAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '../lib/auth'
import {
  useClients, useColumns, useCellValues, useDropdownOptions, useStaff, useTasks, useInvalidateCrm,
} from '../lib/queries'
import { addTask, updateTask, deleteTask } from '../lib/storage'
import { queryClient } from '../lib/queryClient'
import {
  TASK_STATUSES, TASK_STATUS_LABELS, TASK_STATUS_COLORS,
  INSPECTION_TYPES, INSPECTION_TYPE_LABELS, INSPECTION_TYPE_COLORS,
  type Task, type TaskStatus, type TaskKind, type InspectionType,
} from '../lib/types'
import { formatDate, namesMatch } from '../lib/utils'
import { useMyStaff } from '../lib/useMyStaff'
import { useRealtime } from '../lib/useRealtime'

const VIEW_KEY = 'tasks-view'  // 'kanban' | 'list' — запомня се per браузър
const KIND_KEY = 'tasks-kind'  // 'task' | 'inspection'
const DONE_HIDE_AFTER_DAYS = 7

// Колона-акцент за kanban header-а (по-плътни от card цветовете).
const COLUMN_ACCENT: Record<TaskStatus, string> = {
  todo:        'border-t-gray-400',
  in_progress: 'border-t-blue-500',
  done:        'border-t-emerald-500',
  issue:       'border-t-red-500',
}

function initials(name: string): string {
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
}

function isOverdue(task: Task): boolean {
  if (!task.due_date || task.status === 'done') return false
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return task.due_date < iso
}

export function TasksPage() {
  const { user } = useAuth()
  const { myStaff, isAdmin, inDept } = useMyStaff()

  const clientsQ = useClients()
  const columnsQ = useColumns()
  const cellsQ = useCellValues()
  const dropdownsQ = useDropdownOptions()
  const staffQ = useStaff()
  const tasksQ = useTasks()
  const { invalidateTasks } = useInvalidateCrm()

  const clients = useMemo(() => clientsQ.data ?? [], [clientsQ.data])
  const columns = useMemo(() => columnsQ.data ?? [], [columnsQ.data])
  const cells = useMemo(() => cellsQ.data ?? [], [cellsQ.data])
  const dropdowns = useMemo(() => dropdownsQ.data ?? [], [dropdownsQ.data])
  const staff = useMemo(() => staffQ.data ?? [], [staffQ.data])

  // Live обновяване, когато колега мести/създава задачи.
  useRealtime({
    channel: 'tasks',
    tables: ['crm_tasks'],
    onChange: () => invalidateTasks(),
  })

  // Име на фирмата (първата text колона) — за клиент-баджа на картата.
  const nameColId = useMemo(
    () => [...columns].sort((a, b) => a.position - b.position).find(c => c.type === 'text')?.id,
    [columns],
  )
  const nameByClient = useMemo(() => {
    const m = new Map<string, string>()
    if (!nameColId) return m
    cells.forEach(c => {
      if (c.column_id === nameColId && c.value_text) m.set(c.client_id, c.value_text)
    })
    return m
  }, [cells, nameColId])

  const staffById = useMemo(() => {
    const m = new Map<string, string>()
    staff.forEach(s => m.set(s.id, s.full_name))
    return m
  }, [staff])

  // ============================================================
  // Отговорник per фирма — извлича се на живо от колоната „Отговорник"
  // на Работния лист. За проверките отговорникът НЕ се въвежда ръчно.
  // ============================================================
  const respCol = useMemo(() => columns.find(c => c.name === 'Отговорник'), [columns])
  const dropdownValueById = useMemo(() => {
    const m = new Map<string, string>()
    dropdowns.forEach(d => m.set(d.id, d.value))
    return m
  }, [dropdowns])
  const respByClient = useMemo(() => {
    const m = new Map<string, string>()
    if (!respCol) return m
    cells.forEach(c => {
      if (c.column_id !== respCol.id) return
      const v = c.value_text || (c.value_dropdown ? dropdownValueById.get(c.value_dropdown) : '')
      if (v) m.set(c.client_id, v)
    })
    return m
  }, [cells, respCol, dropdownValueById])

  // ============================================================
  // View state + филтри
  // ============================================================
  const [view, setView] = useState<'kanban' | 'list'>(() => {
    try { return (localStorage.getItem(VIEW_KEY) as 'kanban' | 'list') || 'kanban' } catch { return 'kanban' }
  })
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view) } catch { /* noop */ } }, [view])

  // Превключвател Задачи / Проверки — същият механизъм, различен kind.
  const [kind, setKind] = useState<TaskKind>(() => {
    try { return (localStorage.getItem(KIND_KEY) as TaskKind) || 'task' } catch { return 'task' }
  })
  useEffect(() => { try { localStorage.setItem(KIND_KEY, kind) } catch { /* noop */ } }, [kind])
  const isInspections = kind === 'inspection'
  // Проверки създават само admin и Тийм Лийд (основен или допълнителен отдел).
  const canCreate = !isInspections || isAdmin || inDept('Тийм Лийд')

  const [search, setSearch] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [showArchive, setShowArchive] = useState(false)
  const [modal, setModal] = useState<null | { existing?: Task }>(null)

  // ============================================================
  // Видими задачи: Done по-стари от DONE_HIDE_AFTER_DAYS дни се скриват
  // (не се трият) — точно те са „Архивът". Всички филтри (търсене,
  // изпълнител, „Само моите") важат и в двата режима.
  // ============================================================
  const tasks = useMemo(() => {
    const cutoff = Date.now() - DONE_HIDE_AFTER_DAYS * 24 * 60 * 60_000
    let list = (tasksQ.data ?? []).filter(t => {
      if ((t.kind ?? 'task') !== kind) return false
      const archived = t.status === 'done' && new Date(t.updated_at).getTime() < cutoff
      return showArchive ? archived : !archived
    })
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(t =>
        t.title.toLowerCase().includes(q)
        || (t.description ?? '').toLowerCase().includes(q)
        || (t.client_id ? (nameByClient.get(t.client_id) ?? '').toLowerCase().includes(q) : false),
      )
    }
    if (assigneeFilter) list = list.filter(t => t.assignee_staff_id === assigneeFilter)
    if (onlyMine && myStaff) {
      list = isInspections
        // При проверките „моите" = фирмите, на които съм отговорник.
        ? list.filter(t => t.client_id && namesMatch(respByClient.get(t.client_id), myStaff.full_name))
        : list.filter(t => t.assignee_staff_id === myStaff.id)
    }
    return list
  }, [tasksQ.data, kind, isInspections, search, assigneeFilter, onlyMine, showArchive, myStaff, nameByClient, respByClient])

  const byStatus = useMemo(() => {
    const m = new Map<TaskStatus, Task[]>()
    TASK_STATUSES.forEach(s => m.set(s, []))
    tasks.forEach(t => m.get(t.status as TaskStatus)?.push(t))
    m.forEach(list => list.sort((a, b) => a.position - b.position))
    return m
  }, [tasks])

  // ============================================================
  // Смяна на статус — оптимистично + запис.
  // ============================================================
  const moveTask = useCallback(async (taskId: string, status: TaskStatus) => {
    const newPosition = Date.now()  // в края на новата колона
    queryClient.setQueryData<Task[]>(['tasks'], prev =>
      prev?.map(t => t.id === taskId ? { ...t, status, position: newPosition } : t),
    )
    try {
      await updateTask(taskId, { status, position: newPosition })
    } catch {
      toast.error('Преместването не мина (връзката) — опитай пак.')
      invalidateTasks()
    }
  }, [invalidateTasks])

  // HTML5 drag & drop state.
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<TaskStatus | null>(null)

  const ready = !!clientsQ.data && !!columnsQ.data && !!cellsQ.data && !!dropdownsQ.data && !!staffQ.data && !!tasksQ.data
  if (!ready) {
    return (
      <div className="flex items-center justify-center h-full min-h-[50vh] text-muted-foreground">
        <div className="flex items-center gap-2 text-sm">
          <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Зареждане...
        </div>
      </div>
    )
  }

  const activeStaff = staff.filter(s => s.is_active)

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] md:h-screen">
      {/* Header */}
      <div className="px-3 py-2 md:px-5 md:py-3 border-b border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            {isInspections
              ? <ShieldAlert className="h-5 w-5 text-muted-foreground" />
              : <KanbanSquare className="h-5 w-5 text-muted-foreground" />}
            <div>
              <h1 className="text-base md:text-lg font-semibold text-foreground">{isInspections ? 'Проверки' : 'Задачи'}</h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {isInspections
                  ? 'Проверки/ревизии по фирма — отговорникът идва автоматично от Работния лист.'
                  : 'Влачи картите между колоните или кликни на статуса.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Превключвател Задачи / Проверки */}
            <div className="flex items-center border border-border rounded-md bg-background p-0.5">
              <Button
                variant={!isInspections ? 'default' : 'ghost'} size="sm"
                className="h-7 px-3 text-xs" onClick={() => setKind('task')}
              >
                Задачи
              </Button>
              <Button
                variant={isInspections ? 'default' : 'ghost'} size="sm"
                className="h-7 px-3 text-xs" onClick={() => setKind('inspection')}
              >
                Проверки
              </Button>
            </div>
            {/* View toggle */}
            <div className="flex items-center border border-border rounded-md bg-background p-0.5">
              <Button
                variant={view === 'kanban' ? 'default' : 'ghost'} size="sm"
                className="h-7 px-2.5" onClick={() => setView('kanban')} title="Канбан изглед"
              >
                <KanbanSquare className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={view === 'list' ? 'default' : 'ghost'} size="sm"
                className="h-7 px-2.5" onClick={() => setView('list')} title="Списък"
              >
                <List className="h-3.5 w-3.5" />
              </Button>
            </div>
            {canCreate && (
              <Button size="sm" onClick={() => setModal({})}>
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{isInspections ? 'Нова проверка' : 'Нова задача'}</span>
              </Button>
            )}
          </div>
        </div>

        {/* Филтри */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Търси задача / фирма..."
              className="w-full md:w-64 pl-8 pr-3 py-1.5 text-xs border border-border rounded bg-background focus:border-primary focus:outline-none"
            />
          </div>
          {!isInspections && (
            <select
              value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)}
              className="h-8 px-2 text-xs border border-border rounded bg-background focus:border-primary focus:outline-none"
            >
              <option value="">Всички изпълнители</option>
              {activeStaff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          )}
          {myStaff && (
            <button
              type="button"
              onClick={() => setOnlyMine(v => !v)}
              title={isInspections ? 'Само проверки на фирмите, на които съм отговорник' : 'Само задачите, назначени на мен'}
              className={`h-8 px-2.5 text-xs rounded border transition-colors ${
                onlyMine ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-muted/30'
              }`}
            >
              Само моите
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowArchive(v => !v)}
            title={`Готови, скрити от борда преди повече от ${DONE_HIDE_AFTER_DAYS} дни`}
            className={`h-8 px-2.5 text-xs rounded border transition-colors inline-flex items-center gap-1.5 ${
              showArchive ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-muted/30'
            }`}
          >
            <Archive className="h-3.5 w-3.5" />
            Архив
          </button>
          <span className="text-xs text-muted-foreground ml-auto">
            {tasks.length} {tasks.length === 1 ? (isInspections ? 'проверка' : 'задача') : (isInspections ? 'проверки' : 'задачи')}
          </span>
        </div>
      </div>

      {/* Body — архивът е винаги списък (kanban няма смисъл за готови). */}
      <div className="flex-1 overflow-auto p-3 md:p-4">
        {showArchive ? (
          <TaskList
            tasks={tasks}
            isInspections={isInspections}
            archive
            staffById={staffById}
            nameByClient={nameByClient}
            respByClient={respByClient}
            onOpen={t => setModal({ existing: t })}
            onMove={(id, s) => void moveTask(id, s)}
          />
        ) : view === 'kanban' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 items-start">
            {TASK_STATUSES.map(status => {
              const list = byStatus.get(status) ?? []
              return (
                <div
                  key={status}
                  onDragOver={e => { e.preventDefault(); setDragOverCol(status) }}
                  onDragLeave={() => setDragOverCol(cur => cur === status ? null : cur)}
                  onDrop={e => {
                    e.preventDefault()
                    setDragOverCol(null)
                    if (draggedId) { void moveTask(draggedId, status); setDraggedId(null) }
                  }}
                  className={`rounded-lg border border-border bg-muted/20 border-t-4 ${COLUMN_ACCENT[status]} ${
                    dragOverCol === status ? 'ring-2 ring-primary/50 bg-primary/5' : ''
                  }`}
                >
                  <div className="px-3 py-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
                      {TASK_STATUS_LABELS[status]}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{list.length}</span>
                  </div>
                  <div className="px-2 pb-2 space-y-2 min-h-[60px]">
                    {list.map(t => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        // Проверка → отговорникът на фирмата (авто); задача → изпълнителят.
                        assigneeName={(t.kind ?? 'task') === 'inspection'
                          ? (t.client_id ? respByClient.get(t.client_id) ?? null : null)
                          : (t.assignee_staff_id ? staffById.get(t.assignee_staff_id) ?? null : null)}
                        clientName={t.client_id ? nameByClient.get(t.client_id) ?? null : null}
                        onDragStart={() => setDraggedId(t.id)}
                        onDragEnd={() => setDraggedId(null)}
                        onOpen={() => setModal({ existing: t })}
                        onMove={s => void moveTask(t.id, s)}
                      />
                    ))}
                    {list.length === 0 && (
                      <p className="text-[11px] text-muted-foreground/50 text-center py-4">Пусни задача тук</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <TaskList
            tasks={tasks}
            isInspections={isInspections}
            staffById={staffById}
            nameByClient={nameByClient}
            respByClient={respByClient}
            onOpen={t => setModal({ existing: t })}
            onMove={(id, s) => void moveTask(id, s)}
          />
        )}
      </div>

      {modal && (
        <TaskModal
          existing={modal.existing}
          kind={modal.existing ? ((modal.existing.kind ?? 'task') as TaskKind) : kind}
          staff={activeStaff}
          clients={clients}
          nameByClient={nameByClient}
          respByClient={respByClient}
          canDelete={!!modal.existing && (isAdmin || modal.existing.created_by === user?.id)}
          onClose={() => setModal(null)}
          onSaved={async () => { await invalidateTasks(); setModal(null) }}
          userId={user?.id}
        />
      )}
    </div>
  )
}

// ============================================================
// Карта в kanban изгледа
// ============================================================
function TaskCard({
  task, assigneeName, clientName, onDragStart, onDragEnd, onOpen, onMove,
}: {
  task: Task
  assigneeName: string | null
  clientName: string | null
  onDragStart: () => void
  onDragEnd: () => void
  onOpen: () => void
  onMove: (s: TaskStatus) => void
}) {
  const [statusMenu, setStatusMenu] = useState(false)
  const overdue = isOverdue(task)
  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart() }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className="bg-card border border-border rounded-md p-2.5 shadow-sm cursor-pointer hover:shadow-md transition-shadow select-none"
    >
      {/* Проверка: тип-бадж + фирма отгоре (фирмата е главното). */}
      {(task.kind ?? 'task') === 'inspection' && (
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          {task.inspection_type && (
            <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${INSPECTION_TYPE_COLORS[task.inspection_type as InspectionType] ?? ''}`}>
              {INSPECTION_TYPE_LABELS[task.inspection_type as InspectionType] ?? task.inspection_type}
            </span>
          )}
          {clientName && <span className="text-xs font-semibold text-foreground truncate">{clientName}</span>}
        </div>
      )}
      <div className="text-sm font-medium text-foreground leading-tight">{task.title}</div>
      {task.description && (
        <div className="text-[11px] text-muted-foreground leading-tight mt-1 line-clamp-2">{task.description}</div>
      )}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {/* Клик на статус баджа → мини-меню (fallback за телефон, без drag). */}
        <div className="relative">
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setStatusMenu(v => !v) }}
            className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${TASK_STATUS_COLORS[task.status as TaskStatus]}`}
          >
            {TASK_STATUS_LABELS[task.status as TaskStatus] ?? task.status}
          </button>
          {statusMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={e => { e.stopPropagation(); setStatusMenu(false) }} />
              <div className="absolute top-full left-0 mt-1 z-40 min-w-[120px] bg-card border border-border rounded-md shadow-lg overflow-hidden">
                {TASK_STATUSES.filter(s => s !== task.status).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={e => { e.stopPropagation(); setStatusMenu(false); onMove(s) }}
                    className="w-full px-2.5 py-1.5 text-[11px] text-left hover:bg-muted flex items-center gap-1.5"
                  >
                    <span className={`inline-block w-2 h-2 rounded-full ${TASK_STATUS_COLORS[s].split(' ')[0]}`} />
                    {TASK_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {clientName && (task.kind ?? 'task') !== 'inspection' && (
          <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground truncate max-w-[110px]">{clientName}</span>
        )}
        {task.due_date && (
          <span className={`inline-flex items-center gap-0.5 text-[10px] ${overdue ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>
            <CalendarDays className="h-3 w-3" />
            {formatDate(task.due_date)}
          </span>
        )}
        {assigneeName && (
          <span
            title={assigneeName}
            className="ml-auto inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0"
          >
            {initials(assigneeName)}
          </span>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Списъчен изглед
// ============================================================
function TaskList({
  tasks, isInspections, archive = false, staffById, nameByClient, respByClient, onOpen, onMove,
}: {
  tasks: Task[]
  isInspections: boolean
  archive?: boolean
  staffById: Map<string, string>
  nameByClient: Map<string, string>
  respByClient: Map<string, string>
  onOpen: (t: Task) => void
  onMove: (id: string, s: TaskStatus) => void
}) {
  // Подредба: Проблем → В процес → To Do → Готово; вътре по срок/позиция.
  // В архива — по дата на приключване (последна промяна), най-новите отгоре.
  const ordered = useMemo(() => {
    if (archive) return [...tasks].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    const rank: Record<string, number> = { issue: 0, in_progress: 1, todo: 2, done: 3 }
    return [...tasks].sort((a, b) => {
      const r = (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
      if (r !== 0) return r
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
      if (a.due_date) return -1
      if (b.due_date) return 1
      return a.position - b.position
    })
  }, [tasks, archive])

  if (ordered.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-12 text-sm">
        {archive ? 'Архивът е празен.' : isInspections ? 'Няма проверки.' : 'Няма задачи. Натисни „Нова задача".'}
      </p>
    )
  }

  return (
    <table className="w-full text-xs border-collapse bg-card rounded-lg overflow-hidden">
      <thead className="bg-navy text-white">
        <tr>
          <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider min-w-[110px]">Статус</th>
          {isInspections && <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider min-w-[100px]">Тип</th>}
          <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider">{isInspections ? 'Проверка' : 'Задача'}</th>
          <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider min-w-[140px]">{isInspections ? 'Отговорник' : 'Изпълнител'}</th>
          <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider min-w-[140px]">Клиент</th>
          <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider min-w-[100px]">Срок</th>
          {archive && <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider min-w-[100px]">Приключена</th>}
        </tr>
      </thead>
      <tbody>
        {ordered.map((t, i) => {
          const overdue = isOverdue(t)
          const evenBg = i % 2 === 0 ? 'bg-card' : 'bg-muted/20'
          const respName = isInspections
            ? (t.client_id ? respByClient.get(t.client_id) ?? null : null)
            : (t.assignee_staff_id ? staffById.get(t.assignee_staff_id) ?? null : null)
          return (
            <tr key={t.id} className={`border-b border-border ${evenBg} hover:bg-accent/30 ${t.status === 'done' ? 'opacity-60' : ''}`}>
              <td className="px-3 py-1.5" onClick={e => e.stopPropagation()}>
                <select
                  value={t.status}
                  onChange={e => onMove(t.id, e.target.value as TaskStatus)}
                  className={`h-7 px-1 text-[11px] border rounded focus:outline-none ${TASK_STATUS_COLORS[t.status as TaskStatus]}`}
                >
                  {TASK_STATUSES.map(s => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
                </select>
              </td>
              {isInspections && (
                <td className="px-3 py-1.5">
                  {t.inspection_type ? (
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${INSPECTION_TYPE_COLORS[t.inspection_type as InspectionType] ?? ''}`}>
                      {INSPECTION_TYPE_LABELS[t.inspection_type as InspectionType] ?? t.inspection_type}
                    </span>
                  ) : <span className="text-muted-foreground/40">—</span>}
                </td>
              )}
              <td className="px-3 py-1.5 cursor-pointer" onClick={() => onOpen(t)}>
                <div className="font-medium text-foreground">{t.title}</div>
                {t.description && <div className="text-[11px] text-muted-foreground line-clamp-1">{t.description}</div>}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground">
                {respName ? (
                  <span className="inline-flex items-center gap-1.5">
                    <UserIcon className="h-3 w-3" />
                    {respName}
                  </span>
                ) : <span className="text-muted-foreground/40">—</span>}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground">
                {t.client_id ? nameByClient.get(t.client_id) ?? '—' : <span className="text-muted-foreground/40">—</span>}
              </td>
              <td className={`px-3 py-1.5 ${overdue ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>
                {t.due_date ? formatDate(t.due_date) : <span className="text-muted-foreground/40">—</span>}
              </td>
              {archive && (
                <td className="px-3 py-1.5 text-muted-foreground">{formatDate(t.updated_at)}</td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ============================================================
// Modal: Нова / редактирай задача
// ============================================================
function TaskModal({
  existing, kind, staff, clients, nameByClient, respByClient, canDelete, onClose, onSaved, userId,
}: {
  existing?: Task
  kind: TaskKind
  staff: { id: string; full_name: string }[]
  clients: { id: string }[]
  nameByClient: Map<string, string>
  respByClient: Map<string, string>
  canDelete: boolean
  onClose: () => void
  onSaved: () => Promise<void>
  userId?: string
}) {
  const isInspection = kind === 'inspection'
  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [status, setStatus] = useState<TaskStatus>((existing?.status as TaskStatus) ?? 'todo')
  const [assignee, setAssignee] = useState(existing?.assignee_staff_id ?? '')
  const [inspectionType, setInspectionType] = useState<InspectionType>((existing?.inspection_type as InspectionType) ?? 'проверка')
  const [clientId, setClientId] = useState<string | null>(existing?.client_id ?? null)
  const [clientSearch, setClientSearch] = useState('')
  const [dueDate, setDueDate] = useState(existing?.due_date ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const matchingClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase()
    if (!q) return []
    return clients
      .map(c => ({ id: c.id, name: nameByClient.get(c.id) ?? '' }))
      .filter(c => c.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
      .slice(0, 8)
  }, [clients, nameByClient, clientSearch])

  // При проверка фирмата е ЗАДЪЛЖИТЕЛНА.
  const canSave = title.trim() && !saving && (!isInspection || !!clientId)
  // Отговорникът на избраната фирма — авто, само за показване.
  const autoResp = clientId ? respByClient.get(clientId) ?? null : null

  async function save() {
    setSaving(true)
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        status,
        inspection_type: isInspection ? inspectionType : null,
        assignee_staff_id: isInspection ? null : (assignee || null),
        client_id: clientId,
        due_date: dueDate || null,
      }
      // kind се задава само при създаване — не се сменя после.
      if (existing) await updateTask(existing.id, payload)
      else await addTask({ ...payload, kind }, userId)
      toast.success(existing
        ? (isInspection ? 'Проверката е обновена' : 'Задачата е обновена')
        : (isInspection ? 'Проверката е създадена' : 'Задачата е създадена'))
      await onSaved()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!existing) return
    if (!confirm(`Да изтрия „${existing.title}"?`)) return
    setSaving(true)
    try {
      await deleteTask(existing.id)
      toast.success('Изтрито')
      await onSaved()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-xl w-full max-w-md max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-foreground">{existing ? 'Редактирай задача' : 'Нова задача'}</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">{isInspection ? 'Заглавие' : 'Задача'}</label>
            <input
              type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder={isInspection ? 'напр. Ревизия ДДС 2024-2025' : 'Какво трябва да се свърши'} autoFocus
              className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none"
            />
          </div>

          {isInspection && (
            <div>
              <label className="text-xs font-medium text-foreground block mb-1.5">Тип</label>
              <div className="flex flex-wrap gap-1.5">
                {INSPECTION_TYPES.map(t => (
                  <button
                    key={t} type="button" onClick={() => setInspectionType(t)}
                    className={`px-2.5 py-1 text-xs rounded border transition-all ${
                      inspectionType === t
                        ? `${INSPECTION_TYPE_COLORS[t]} ring-2 ring-offset-1 ring-current/30`
                        : 'bg-background border-border text-muted-foreground hover:bg-muted/30'
                    }`}
                  >
                    {INSPECTION_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-foreground block mb-1.5">Статус</label>
            <div className="flex flex-wrap gap-1.5">
              {TASK_STATUSES.map(s => (
                <button
                  key={s} type="button" onClick={() => setStatus(s)}
                  className={`px-2.5 py-1 text-xs rounded border transition-all ${
                    status === s
                      ? `${TASK_STATUS_COLORS[s]} ring-2 ring-offset-1 ring-current/30`
                      : 'bg-background border-border text-muted-foreground hover:bg-muted/30'
                  }`}
                >
                  {TASK_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {!isInspection && (
              <div>
                <label className="text-xs font-medium text-foreground block mb-1">Изпълнител</label>
                <select
                  value={assignee} onChange={e => setAssignee(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none"
                >
                  <option value="">— никой —</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">Срок</label>
              <input
                type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none"
              />
              {dueDate && <p className="text-[10px] text-muted-foreground mt-0.5">{formatDate(dueDate)}</p>}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1">{isInspection ? 'Фирма (задължително)' : 'Клиент (по желание)'}</label>
            {clientId ? (
              <div className="flex items-center justify-between px-2.5 py-1.5 border border-border rounded-md bg-muted/30">
                <span className="text-sm">{nameByClient.get(clientId) ?? '—'}</span>
                <button type="button" onClick={() => setClientId(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text" value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                  placeholder="Търси фирма..."
                  className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none"
                />
                {matchingClients.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-10 bg-card border border-border rounded-md shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                    {matchingClients.map(c => (
                      <button
                        key={c.id} type="button"
                        onClick={() => { setClientId(c.id); setClientSearch('') }}
                        className="w-full text-left px-2.5 py-1.5 text-sm hover:bg-accent/50 border-b border-border last:border-0"
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Авто-отговорник — извлича се от Работния лист, само за информация. */}
          {isInspection && clientId && (
            <div className="px-2.5 py-1.5 rounded-md bg-sky-50 border border-sky-200 dark:bg-sky-950/30 dark:border-sky-800 text-xs">
              <span className="text-sky-700 dark:text-sky-300">Отговорник (авто от Работния лист): </span>
              <span className="font-semibold text-sky-900 dark:text-sky-100">{autoResp ?? 'не е зададен за тази фирма'}</span>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Описание</label>
            <textarea
              value={description} onChange={e => setDescription(e.target.value)}
              placeholder="детайли — по желание" rows={3}
              className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none resize-y"
            />
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-border gap-2">
          {canDelete ? (
            <Button variant="ghost" className="text-destructive" onClick={remove} disabled={saving}>
              <Trash2 className="h-3.5 w-3.5" /> Изтрий
            </Button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>Отказ</Button>
            <Button onClick={save} disabled={!canSave}>
              {saving ? 'Записване...' : (existing ? 'Запиши' : 'Създай')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
