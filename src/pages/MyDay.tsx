import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, CalendarDays, CheckSquare, ClipboardList, Users,
  Newspaper, Inbox, Sparkles, ArrowRight,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useMyStaff } from '../lib/useMyStaff'
import {
  useTasks, useClients, useColumns, useCellValues, useDropdownOptions,
  useChecklist, useMonthlyWork, useAbsences, useEvents, useStaff,
  useWorkCalendar, useMonthReviewers, useIndustryNews, useNews,
} from '../lib/queries'
import {
  buildCellIndex, buildDropdownIndex, clientDisplayName, resolveCellText,
  resolveDropdownText,
} from '../lib/tableIndices'
import { previousMonth, ddsDeadline, isAfterDdsDeadline, formatDate } from '../lib/utils'
import { CHECKLIST_FIELDS, TASK_STATUS_COLORS, TASK_STATUS_LABELS, ABSENCE_TYPE_LABELS, type Task } from '../lib/types'
import { isHiddenStatus } from '../lib/statusBadge'
import {
  dueBucket, dueLabel, isMyFirm, isChecklistExcludedStatus, isOpenTask,
  sortByUrgency, absentOn, backOn, addDaysIso, workingDaysUntil,
} from '../lib/myDay'
import { isoOf } from '../lib/holidays'

// ============================================================
// „Моят ден" — какво чака ЛИЧНО теб днес.
//
// Нищо ново в базата: страницата събира от Задачи, Чек лист, Работен
// лист и Календар. Това е екранната версия на писмото, което
// `mail-send` праща сутрин — с две разлики: тук е ЖИВО (писмото е
// снимка от 06:15) и стига до колегите БЕЗ попълнен имейл, които
// иначе не получават нищо.
//
// ⚠️ Правилата „кое е мое" са в `src/lib/myDay.ts` (тествани) и са
// ПОВТОРЕНИ в `mail-send` (Deno, един файл нарочно). Пипнеш ли ги
// тук, пипни ги и там — писмото и екранът трябва да казват едно.
//
// ЗА ТРЗ отделът чек листът и работният лист НЕ се показват: скрити
// са им и на своите екрани. Блокът не стои празен, а изобщо липсва —
// празен блок изглежда като счупено, а не като „не е за теб".
// ============================================================

const MONTHS = [
  'януари', 'февруари', 'март', 'април', 'май', 'юни',
  'юли', 'август', 'септември', 'октомври', 'ноември', 'декември',
]

function Section({ icon: Icon, title, hint, children, tone = 'plain' }: {
  icon: typeof AlertTriangle
  title: string
  hint?: string
  children: React.ReactNode
  tone?: 'plain' | 'alert'
}) {
  return (
    <section className={`rounded-xl border p-4 ${
      tone === 'alert'
        ? 'border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20'
        : 'border-border bg-card'
    }`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon className={`h-4 w-4 ${tone === 'alert' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`} />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {hint && <span className="text-xs text-muted-foreground">· {hint}</span>}
      </div>
      {children}
    </section>
  )
}

function TaskLine({ task, todayIso, cal, clientName }: {
  task: Task; todayIso: string; cal: ReturnType<typeof useWorkCalendar>; clientName: string
}) {
  const bucket = dueBucket(task.due_date, todayIso)
  return (
    <li className="flex items-start gap-2 py-1.5 border-b border-border/50 last:border-0">
      <span className={`mt-0.5 shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-semibold ${TASK_STATUS_COLORS[task.status as keyof typeof TASK_STATUS_COLORS] ?? ''}`}>
        {TASK_STATUS_LABELS[task.status as keyof typeof TASK_STATUS_LABELS] ?? task.status}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-foreground">
          {task.title}
          {task.kind === 'inspection' && (
            <span className="ml-1.5 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400">проверка</span>
          )}
        </span>
        <span className="block text-[11px] text-muted-foreground">
          {clientName && <>{clientName} · </>}
          {task.due_date ? <>срок {formatDate(task.due_date)} · </> : null}
          <span className={bucket === 'overdue' ? 'text-red-600 dark:text-red-400 font-medium' : ''}>
            {dueLabel(task.due_date, todayIso, cal)}
          </span>
        </span>
      </span>
    </li>
  )
}

export function MyDayPage() {
  const { user } = useAuth()
  const { myStaff, inDept, isAdmin } = useMyStaff()
  const isTrz = inDept('ТРЗ')
  const myName = user?.full_name ?? ''

  const today = new Date()
  const todayIso = isoOf(today)
  const work = previousMonth()
  const cal = useWorkCalendar()

  const tasksQ = useTasks()
  const clientsQ = useClients()
  const columnsQ = useColumns()
  const cellsQ = useCellValues()
  const dropdownsQ = useDropdownOptions()
  const staffQ = useStaff()
  const checklistQ = useChecklist(work.year, work.month)
  const mworkQ = useMonthlyWork(work.year, work.month)
  const absencesQ = useAbsences(today.getFullYear())
  const eventsQ = useEvents(today.getFullYear())
  const reviewersQ = useMonthReviewers(work.year, work.month)
  const newsQ = useNews()
  const industryQ = useIndustryNews()

  const columns = useMemo(() => columnsQ.data ?? [], [columnsQ.data])
  const cellIdx = useMemo(() => buildCellIndex(cellsQ.data ?? []), [cellsQ.data])
  const dropdownIdx = useMemo(() => buildDropdownIndex(dropdownsQ.data ?? []), [dropdownsQ.data])

  const statusCol = useMemo(() => columns.find(c => c.name === 'Статус'), [columns])
  const accountantCol = useMemo(() => columns.find(c => c.name === 'Счетоводител'), [columns])
  const respCol = useMemo(() => columns.find(c => c.name === 'Отговорник'), [columns])

  // ============================================================
  // Моите фирми — един път, ползва се и от чек листа, и от работния лист.
  // „Счетоводител" и „Отговорник" са dropdown-и, СВЪРЗАНИ СЪС СЛУЖИТЕЛ:
  // стойността стои във value_text, затова `resolveCellText`, не
  // `resolveDropdownText` (картата на клиента излезе празна точно тук).
  // ============================================================
  const myFirms = useMemo(() => {
    return (clientsQ.data ?? []).map(c => ({
      id: c.id,
      name: clientDisplayName(c.id, columns, cellIdx),
      status: resolveDropdownText(c.id, statusCol, cellIdx, dropdownIdx),
      accountant: resolveCellText(c.id, accountantCol, cellIdx, dropdownIdx),
      responsible: resolveCellText(c.id, respCol, cellIdx, dropdownIdx),
    })).filter(f => isMyFirm(f, myName))
  }, [clientsQ.data, columns, cellIdx, dropdownIdx, statusCol, accountantCol, respCol, myName])

  const clientNameById = useMemo(() => {
    const m = new Map<string, string>()
    ;(clientsQ.data ?? []).forEach(c => m.set(c.id, clientDisplayName(c.id, columns, cellIdx)))
    return m
  }, [clientsQ.data, columns, cellIdx])

  // ---------- Задачи ----------
  const myTasks = useMemo(() => {
    if (!myStaff) return []
    return (tasksQ.data ?? [])
      .filter(t => t.assignee_staff_id === myStaff.id && isOpenTask(t))
  }, [tasksQ.data, myStaff])

  const urgent = useMemo(
    () => sortByUrgency(myTasks.filter(t => ['overdue', 'today'].includes(dueBucket(t.due_date, todayIso))), todayIso),
    [myTasks, todayIso],
  )
  const upcoming = useMemo(
    () => sortByUrgency(myTasks.filter(t => dueBucket(t.due_date, todayIso) === 'soon'), todayIso),
    [myTasks, todayIso],
  )
  const noDeadline = useMemo(
    () => myTasks.filter(t => !t.due_date).length,
    [myTasks],
  )

  // ---------- ДДС чек лист ----------
  const deadline = ddsDeadline(work.year, work.month)
  const deadlineIso = isoOf(deadline)
  const daysToDeadline = workingDaysUntil(todayIso, deadlineIso, cal)
  const deadlinePassed = isAfterDdsDeadline(work.year, work.month)

  const checklistTodo = useMemo(() => {
    if (isTrz) return []
    const rows = new Map((checklistQ.data ?? []).map(r => [r.client_id, r]))
    return myFirms
      .filter(f => !isHiddenStatus(f.status) && !isChecklistExcludedStatus(f.status))
      .map(f => {
        const row = rows.get(f.id)
        const done = row ? CHECKLIST_FIELDS.filter(x => row[x.key]).length : 0
        return { ...f, done, total: CHECKLIST_FIELDS.length }
      })
      .filter(f => f.done < f.total)
      .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  }, [myFirms, checklistQ.data, isTrz])

  // ---------- Работен лист ----------
  // Само докато месецът НЕ е заключен: след 14-ти полетата са само за
  // четене и списък „довърши това" е подкана към нещо невъзможно.
  const worksheetTodo = useMemo(() => {
    if (isTrz || deadlinePassed) return []
    const rows = new Map((mworkQ.data ?? []).map(r => [r.client_id, r]))
    return myFirms
      .filter(f => !isHiddenStatus(f.status))
      .map(f => ({ ...f, row: rows.get(f.id) }))
      .filter(f => !f.row?.submitted_at || f.row?.result_amount == null)
      .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  }, [myFirms, mworkQ.data, isTrz, deadlinePassed])

  // ---------- Екипът ----------
  const staffById = useMemo(() => {
    const m = new Map<string, string>()
    ;(staffQ.data ?? []).forEach(s => m.set(s.id, s.full_name))
    return m
  }, [staffQ.data])

  const absences = useMemo(() => absencesQ.data ?? [], [absencesQ.data])
  const outToday = useMemo(() => absentOn(absences, todayIso), [absences, todayIso])
  const returning = useMemo(() => backOn(absences, todayIso, cal), [absences, todayIso, cal])
  const pendingRequests = useMemo(
    () => absences.filter(a => a.status === 'pending').length,
    [absences],
  )

  // Събитието влиза, ако ОБХВАЩА някой от следващите 7 дни, не само ако
  // започва в тях — многодневно събитие, тръгнало вчера, още върви.
  const weekEvents = useMemo(() => {
    const until = addDaysIso(todayIso, 7)
    return (eventsQ.data ?? [])
      .filter(e => e.start_date <= until && e.end_date >= todayIso)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
  }, [eventsQ.data, todayIso])

  // ---------- Дребните ----------
  const amReviewer = useMemo(() => {
    const r = reviewersQ.data
    if (!r || !myStaff) return false
    return r.reviewer1_staff_id === myStaff.id || r.reviewer2_staff_id === myStaff.id
  }, [reviewersQ.data, myStaff])

  const freshNews = useMemo(() => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const team = (newsQ.data ?? []).filter(n => n.created_at > since).length
    const auto = (industryQ.data ?? []).filter(n => n.created_at > since).length
    return { team, auto }
  }, [newsQ.data, industryQ.data])

  const firstName = (myName.trim().split(/\s+/)[0] ?? '').trim()
  const nothingUrgent = urgent.length === 0 && checklistTodo.length === 0 && worksheetTodo.length === 0

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">

        {/* Главата — днешното, работният месец и срокът за ДДС. */}
        <header className="rounded-xl border border-border bg-card p-4">
          <h1 className="text-xl font-semibold text-foreground">
            {firstName ? `Здравей, ${firstName}` : 'Моят ден'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {today.toLocaleDateString('bg-BG', { weekday: 'long', day: 'numeric', month: 'long' })}
            {' · работен месец '}
            <strong className="text-foreground">{MONTHS[work.month - 1]} {work.year}</strong>
          </p>
          {!isTrz && (
            <p className={`mt-2 text-sm ${deadlinePassed ? 'text-muted-foreground' : daysToDeadline <= 3 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-foreground'}`}>
              {deadlinePassed
                ? `Срокът за ДДС (${formatDate(deadlineIso)}) е минал — работният лист е заключен.`
                : daysToDeadline === 0
                  ? `Срокът за ДДС е ДНЕС (${formatDate(deadlineIso)}).`
                  : `До срока за ДДС (${formatDate(deadlineIso)}) ${daysToDeadline === 1 ? 'остава 1 работен ден' : `остават ${daysToDeadline} работни дни`}.`}
            </p>
          )}
        </header>

        {nothingUrgent && (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20 p-4 text-sm text-emerald-900 dark:text-emerald-200">
            Няма просрочено и няма недовършено при теб. Спокоен ден.
          </div>
        )}

        {/* 1. Гори */}
        {urgent.length > 0 && (
          <Section icon={AlertTriangle} title="Просрочени и за днес" tone="alert"
            hint={`${urgent.length} ${urgent.length === 1 ? 'задача' : 'задачи'}`}>
            <ul>
              {urgent.map(t => (
                <TaskLine key={t.id} task={t} todayIso={todayIso} cal={cal}
                  clientName={t.client_id ? (clientNameById.get(t.client_id) ?? '') : ''} />
              ))}
            </ul>
            <Link to="/tasks" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Всички задачи <ArrowRight className="h-3 w-3" />
            </Link>
          </Section>
        )}

        {/* 2. Чек лист */}
        {!isTrz && checklistTodo.length > 0 && (
          <Section icon={CheckSquare} title="ДДС чек лист — моите незавършени"
            hint={`${checklistTodo.length} ${checklistTodo.length === 1 ? 'фирма' : 'фирми'}`}>
            <ul className="space-y-1">
              {checklistTodo.slice(0, 12).map(f => (
                <li key={f.id} className="flex items-center gap-2 text-sm">
                  <Link to={`/client/${f.id}`} className="flex-1 min-w-0 truncate text-foreground hover:text-primary hover:underline">
                    {f.name}
                  </Link>
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                    {f.done} от {f.total}
                  </span>
                </li>
              ))}
            </ul>
            {checklistTodo.length > 12 && (
              <p className="mt-1 text-[11px] text-muted-foreground">…и още {checklistTodo.length - 12}</p>
            )}
            <Link to="/checklist" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Отвори чек листа <ArrowRight className="h-3 w-3" />
            </Link>
          </Section>
        )}

        {/* 3. Работен лист */}
        {!isTrz && worksheetTodo.length > 0 && (
          <Section icon={ClipboardList} title="Работен лист — непопълнено при мен"
            hint={`${worksheetTodo.length} ${worksheetTodo.length === 1 ? 'фирма' : 'фирми'} за ${MONTHS[work.month - 1]}`}>
            <ul className="space-y-1">
              {worksheetTodo.slice(0, 12).map(f => (
                <li key={f.id} className="flex items-center gap-2 text-sm">
                  <Link to={`/client/${f.id}`} className="flex-1 min-w-0 truncate text-foreground hover:text-primary hover:underline">
                    {f.name}
                  </Link>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {f.row?.result_amount == null ? 'без резултат' : 'без дата на подаване'}
                  </span>
                </li>
              ))}
            </ul>
            {worksheetTodo.length > 12 && (
              <p className="mt-1 text-[11px] text-muted-foreground">…и още {worksheetTodo.length - 12}</p>
            )}
            <Link to="/worksheet" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Отвори работния лист <ArrowRight className="h-3 w-3" />
            </Link>
          </Section>
        )}

        {/* 4. Напред */}
        {(upcoming.length > 0 || noDeadline > 0) && (
          <Section icon={CalendarDays} title="Задачи напред" hint="следващите 7 дни">
            {upcoming.length > 0 ? (
              <ul>
                {upcoming.map(t => (
                  <TaskLine key={t.id} task={t} todayIso={todayIso} cal={cal}
                    clientName={t.client_id ? (clientNameById.get(t.client_id) ?? '') : ''} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Нищо със срок в следващите 7 дни.</p>
            )}
            {noDeadline > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Имаш и {noDeadline} {noDeadline === 1 ? 'задача' : 'задачи'} без срок.
              </p>
            )}
          </Section>
        )}

        {/* 5. Екипът */}
        <Section icon={Users} title="Екипът днес">
          {outToday.length === 0 ? (
            <p className="text-sm text-muted-foreground">Днес всички са на линия.</p>
          ) : (
            <ul className="space-y-1">
              {outToday.map(a => (
                <li key={a.id} className="text-sm text-foreground">
                  <span className="font-medium">{staffById.get(a.staff_id) ?? '—'}</span>
                  <span className="text-muted-foreground">
                    {' — '}{ABSENCE_TYPE_LABELS[a.type as keyof typeof ABSENCE_TYPE_LABELS] ?? a.type}
                    {' до '}{formatDate(a.end_date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {returning.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Връща се на работа: {returning.map(a => staffById.get(a.staff_id) ?? '—').join(', ')}
            </p>
          )}
          {weekEvents.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/60">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Тази седмица</p>
              <ul className="space-y-0.5">
                {weekEvents.map(e => (
                  <li key={e.id} className="text-sm text-foreground">
                    <span className="text-muted-foreground tabular-nums">{formatDate(e.start_date)}</span>
                    {' — '}{e.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Link to="/calendar" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
            Календарът <ArrowRight className="h-3 w-3" />
          </Link>
        </Section>

        {/* 6. Само за admin */}
        {isAdmin && pendingRequests > 0 && (
          <Section icon={Inbox} title="Чака твоето одобрение"
            hint={`${pendingRequests} ${pendingRequests === 1 ? 'заявка' : 'заявки'}`}>
            <Link to="/absence-requests" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
              Заявки за отпуска <ArrowRight className="h-3 w-3" />
            </Link>
          </Section>
        )}

        {/* 7. Дребните */}
        {(amReviewer || freshNews.team > 0 || freshNews.auto > 0) && (
          <Section icon={Sparkles} title="Друго">
            <ul className="space-y-1 text-sm">
              {amReviewer && (
                <li className="text-amber-800 dark:text-amber-300">
                  Ти си проверяващ за {MONTHS[work.month - 1]} {work.year}.
                </li>
              )}
              {freshNews.team > 0 && (
                <li>
                  <Link to="/calendar" className="text-primary hover:underline inline-flex items-center gap-1">
                    <Newspaper className="h-3.5 w-3.5" />
                    {freshNews.team} {freshNews.team === 1 ? 'нова новина' : 'нови новини'} от екипа
                  </Link>
                </li>
              )}
              {freshNews.auto > 0 && (
                <li className="text-muted-foreground">
                  {freshNews.auto} {freshNews.auto === 1 ? 'новина' : 'новини'} от бранша за последното денонощие
                </li>
              )}
            </ul>
          </Section>
        )}

      </div>
    </div>
  )
}
