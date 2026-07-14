import { useMemo, useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, CalendarDays, Plus, Trash2, X, Download, Sparkles, Pencil, Newspaper, Pin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '../lib/auth'
import {
  useStaff, useAbsences, useVacationQuotas, useEvents, useNews, useInvalidateCrm,
} from '../lib/queries'
import { addAbsence, updateAbsence, deleteAbsence, approveAbsence, rejectAbsence, addEvent, updateEvent, deleteEvent, addNews, updateNews, deleteNews } from '../lib/storage'
import {
  ABSENCE_TYPES, ABSENCE_TYPE_LABELS, ABSENCE_TYPE_COLORS,
  EVENT_TYPES, EVENT_TYPE_LABELS, EVENT_TYPE_COLORS,
  NEWS_TYPES, NEWS_TYPE_LABELS, NEWS_TYPE_COLORS, NEWS_TYPE_ICONS,
  type AbsenceType, type Absence, type EventType, type CompanyEvent, type NewsType, type NewsItem,
} from '../lib/types'
import type { StaffMember as StaffMemberType } from '../lib/storage'
import {
  formatDate, formatDateTime,
  workingDaysInYear, workingDaysInMonth, workingDaysInMonthTotal,
} from '../lib/utils'
import { useMyStaff } from '../lib/useMyStaff'
import { exportRowsToExcel } from '../lib/export'

const MONTH_NAMES = [
  'Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни',
  'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември',
]
const WEEKDAY_SHORT = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']  // 0..6

// ISO дата (YYYY-MM-DD) от компоненти.
function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

// За даден ден връща typed absence, ако служителят е отсъстващ. null иначе.
function findAbsenceForDay(absences: Absence[], staffId: string, dateIso: string): Absence | null {
  for (const a of absences) {
    if (a.staff_id !== staffId) continue
    if (dateIso >= a.start_date && dateIso <= a.end_date) return a
  }
  return null
}

export function CalendarPage() {
  const { user } = useAuth()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const staffQ = useStaff()
  const absencesQ = useAbsences(year)
  const eventsQ = useEvents(year)
  const newsQ = useNews()
  const quotasQ = useVacationQuotas(year)
  const { invalidateAbsences, invalidateEvents, invalidateNews } = useInvalidateCrm()

  const allStaff: StaffMemberType[] = useMemo(() => (staffQ.data ?? []), [staffQ.data])
  const staff: StaffMemberType[] = useMemo(() => allStaff.filter(s => s.is_active), [allStaff])
  const absences = useMemo(() => absencesQ.data ?? [], [absencesQ.data])
  const events = useMemo(() => eventsQ.data ?? [], [eventsQ.data])
  const news = useMemo(() => newsQ.data ?? [], [newsQ.data])
  const quotas = useMemo(() => quotasQ.data ?? [], [quotasQ.data])

  // Текущият потребител → staff запис — от споделения useMyStaff lookup.
  const { myStaff, isAdmin } = useMyStaff()
  // Manager + отдел ТРЗ → разширен достъп: редактира чужди редове в
  // календара и вижда чакащите заявки, но БЕЗ право да одобрява/отказва.
  const isManagerTrz = user?.role === 'manager' && myStaff?.department === 'ТРЗ'
  // Manager + отдел Управление → може да добавя/редактира фирмени събития
  // (събрания, тиймбилдинг, обучения и т.н.). Без други права над календара.
  const isManagerMgmt = user?.role === 'manager' && myStaff?.department === 'Управление'
  const canEditEvents = isAdmin || isManagerMgmt

  // Видимост на отсъствие:
  //   - approved → всички виждат
  //   - pending/rejected → подателят (свой ред) + admin + manager-ТРЗ
  const isAbsenceVisible = useCallback((a: Absence) => {
    if (a.status === 'approved') return true
    if (isAdmin || isManagerTrz) return true
    if (myStaff && a.staff_id === myStaff.id) return true
    return false
  }, [isAdmin, isManagerTrz, myStaff])

  const visibleAbsences = useMemo(
    () => absences.filter(isAbsenceVisible),
    [absences, isAbsenceVisible],
  )

  // ============================================================
  // Личен баланс на отпуската — топ на страницата.
  // Оставащ = prev + current + add − Σ(work days vacation, само одобрени)
  // Чакащите заявки не намаляват баланса (още не са одобрени).
  // ============================================================
  const myBalance = useMemo(() => {
    if (!myStaff) return null
    const quota = quotas.find(q => q.staff_id === myStaff.id)
    const entitlement = (Number(quota?.prev_years_days) || 0)
      + (Number(quota?.current_year_days) || 20)
      + (Number(quota?.additional_days) || 0)
    let used = 0
    let pendingDays = 0
    absences.forEach(a => {
      if (a.staff_id !== myStaff.id || a.type !== 'vacation') return
      const days = workingDaysInYear(a.start_date, a.end_date, year)
      if (a.status === 'approved') used += days
      else if (a.status === 'pending') pendingDays += days
    })
    return { remaining: entitlement - used, pendingDays }
  }, [myStaff, quotas, absences, year])

  // Брой чакащи заявки (всички служители) — admin вижда в горната лента.
  const pendingTotal = useMemo(
    () => absences.filter(a => a.status === 'pending').length,
    [absences],
  )

  // ============================================================
  // Експорт за месеца — справка за ТРЗ (заплати).
  // Само одобрени отсъствия, работни дни Пн-Пт, активни служители.
  // Колони: Име | Длъжност | Отдел | Раб. дни | Отпуска | Болничен |
  //         Служебно | Дистанционно | Майчинство | Учебен | Неплатен |
  //         Σ Отсъствия | Присъствие | Дати на отсъствия
  // ============================================================
  const exportMonthly = useCallback(async () => {
    const totalWorkDays = workingDaysInMonthTotal(year, month)
    const headers = [
      'Име', 'Длъжност', 'Отдел', 'Раб. дни',
      'Отпуска', 'Болничен', 'Служебно', 'Дистанционно', 'Майчинство', 'Учебен', 'Неплатен',
      'Σ отсъствия', 'Присъствие', 'Дати на отсъствия',
    ]
    const rows = staff.map(s => {
      const perType: Record<string, number> = {
        vacation: 0, sick: 0, business: 0, remote: 0, maternity: 0, study: 0, unpaid: 0,
      }
      // Списък с интервали per тип за форматиране в края.
      const datesPerType: Record<string, string[]> = {
        vacation: [], sick: [], business: [], remote: [], maternity: [], study: [], unpaid: [],
      }
      absences.forEach(a => {
        if (a.staff_id !== s.id || a.status !== 'approved') return
        const days = workingDaysInMonth(a.start_date, a.end_date, year, month)
        if (days <= 0 || perType[a.type as string] === undefined) return
        perType[a.type as string] += days
        // Клипваме диапазона до границите на месеца, за да не „изтичаме" в съседен месец.
        const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
        const lastDay = new Date(year, month, 0).getDate()
        const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
        const start = a.start_date < monthStart ? monthStart : a.start_date
        const end = a.end_date > monthEnd ? monthEnd : a.end_date
        const sd = parseInt(start.slice(8, 10), 10)
        const ed = parseInt(end.slice(8, 10), 10)
        datesPerType[a.type as string].push(sd === ed ? String(sd) : `${sd}-${ed}`)
      })
      const totalAbsent = Object.values(perType).reduce((s, x) => s + x, 0)

      // „Отпуска: 3-7; 15. Болничен: 12." — компактно, една клетка.
      const dateLabels: Record<string, string> = {
        vacation: 'Отпуска', sick: 'Болничен', business: 'Служебно', remote: 'Дистанционно',
        maternity: 'Майчинство', study: 'Учебен', unpaid: 'Неплатен',
      }
      const dateSummary = Object.entries(datesPerType)
        .filter(([, list]) => list.length > 0)
        .map(([type, list]) => `${dateLabels[type]}: ${list.join(', ')}`)
        .join('; ')

      return [
        s.full_name,
        s.position ?? '',
        s.department ?? '',
        totalWorkDays,
        perType.vacation, perType.sick, perType.business, perType.remote,
        perType.maternity, perType.study, perType.unpaid,
        totalAbsent,
        Math.max(0, totalWorkDays - totalAbsent),
        dateSummary,
      ] as (string | number)[]
    })

    // Σ ред в края
    const sums: (string | number)[] = headers.map((_, i) => {
      if (i < 3) return ''
      if (i === 3) return staff.length > 0 ? totalWorkDays : 0  // Раб. дни — еднакво за всички
      if (i === headers.length - 1) return ''  // „Дати" колона — не се сумира
      return rows.reduce((acc, r) => acc + (Number(r[i]) || 0), 0)
    })
    sums[0] = 'Σ'

    const monthLabel = MONTH_NAMES[month - 1]
    await exportRowsToExcel({
      headers,
      rows: [...rows, sums as (string | number)[]],
      sheetName: `${monthLabel} ${year}`.slice(0, 31),
      fileName: `Отпуски_${monthLabel}_${year}.xlsx`,
    })
    toast.success(`Експортът на ${monthLabel} ${year} е готов`)
  }, [staff, absences, year, month])

  const canExport = isAdmin || myStaff?.department === 'ТРЗ'

  // ============================================================
  // Месечен grid: дни в месеца → колони. Cell-ите се рендерират в JSX.
  // ============================================================
  const daysCount = daysInMonth(year, month)
  const days = useMemo(() => Array.from({ length: daysCount }, (_, i) => i + 1), [daysCount])

  // Modal state (само ако canEdit).
  const [modal, setModal] = useState<null | { staffId: string; staffName: string; existing?: Absence; defaultDate?: string }>(null)
  const [eventModal, setEventModal] = useState<null | { existing?: CompanyEvent; defaultDate?: string }>(null)
  const [newsModal, setNewsModal] = useState<null | { existing?: NewsItem }>(null)
  const [selectedDay, setSelectedDay] = useState<string>(() => {
    const t = new Date()
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  })

  // Събития, които покриват даден ден.
  const eventsForDay = useCallback((dateIso: string): CompanyEvent[] => {
    return events.filter(e => dateIso >= e.start_date && dateIso <= e.end_date)
  }, [events])

  // Кой ред може да редактира потребителят:
  //   admin → всички (записът е одобрен директно)
  //   manager-ТРЗ → всички (записът отива за одобрение от admin)
  //   служител → само своя
  const canEditRow = useCallback((staffId: string) => {
    if (isAdmin || isManagerTrz) return true
    return !!myStaff && myStaff.id === staffId
  }, [isAdmin, isManagerTrz, myStaff])

  const openCell = useCallback((staffId: string, staffName: string, dateIso: string) => {
    setSelectedDay(dateIso)  // винаги обновявай избрания ден (за events panel)
    if (!canEditRow(staffId)) return
    const existing = findAbsenceForDay(visibleAbsences, staffId, dateIso)
    setModal({ staffId, staffName, existing: existing ?? undefined, defaultDate: dateIso })
  }, [canEditRow, visibleAbsences])

  const ready = !!staffQ.data && !!absencesQ.data && !!quotasQ.data && !!eventsQ.data && !!newsQ.data

  const goPrev = () => {
    if (month === 1) { setYear(year - 1); setMonth(12) } else setMonth(month - 1)
  }
  const goNext = () => {
    if (month === 12) { setYear(year + 1); setMonth(1) } else setMonth(month + 1)
  }
  const goToday = () => {
    const t = new Date()
    setYear(t.getFullYear())
    setMonth(t.getMonth() + 1)
  }

  // ISO дата на днешния ден — за маркер „today" в grid-а.
  const todayIso = useMemo(() => {
    const t = new Date()
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  }, [])
  const isViewingThisMonth = year === now.getFullYear() && month === now.getMonth() + 1
  const todayDay = now.getDate()

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

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
      {/* Header */}
      <div className="px-3 py-2 md:px-5 md:py-3 border-b border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-5 w-5 text-muted-foreground" />
            <div>
              <h1 className="text-base md:text-lg font-semibold text-foreground">Календар на присъствието</h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Отпуски, болнични, командировки.{' '}
                {isAdmin
                  ? 'Като admin записите ти стават одобрени директно.'
                  : myStaff
                    ? 'Кликни на свой ред за заявка — admin я одобрява.'
                    : 'Само admin/ТРЗ редактира.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 border border-border rounded-md bg-background">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goPrev} title="Предходен месец">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2 text-sm font-semibold whitespace-nowrap">{MONTH_NAMES[month - 1]} {year}</span>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goNext} title="Следващ месец">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={goToday} title="Към текущия месец" disabled={isViewingThisMonth}>
              Днес
            </Button>
            {canEditEvents && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEventModal({ defaultDate: selectedDay })}
                title="Добави фирмено събитие"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Ново събитие</span>
              </Button>
            )}
            {canExport && (
              <Button
                variant="outline"
                size="sm"
                onClick={exportMonthly}
                title="Excel справка за ТРЗ — отсъствия за месеца, разбити по тип"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Експорт</span>
              </Button>
            )}
          </div>
        </div>

        {/* Личен баланс — само за служители с регистриран staff запис. */}
        {myStaff && myBalance && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800">
              <span className="text-xs text-emerald-700 dark:text-emerald-300">Оставащ платен отпуск ({year}):</span>
              <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">{myBalance.remaining} дни</span>
            </div>
            {myBalance.pendingDays > 0 && (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800" title="Дни в чакащи заявки — не намаляват баланса до одобрение">
                <span className="text-xs text-amber-700 dark:text-amber-300">Чакащи за одобрение:</span>
                <span className="text-sm font-semibold text-amber-800 dark:text-amber-200">{myBalance.pendingDays} дни</span>
              </div>
            )}
            {/* Видим бутон „Заяви отпуска" — основният path за служителите. */}
            <Button
              size="sm"
              onClick={() => myStaff && setModal({ staffId: myStaff.id, staffName: myStaff.full_name, defaultDate: todayIso })}
              className="bg-primary text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              {isAdmin ? 'Добави отсъствие' : 'Заяви отсъствие'}
            </Button>
            {(isAdmin || isManagerTrz) && pendingTotal > 0 && (
              <a href="#/absence-requests" className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-sky-50 border border-sky-200 dark:bg-sky-950/30 dark:border-sky-800 hover:bg-sky-100 dark:hover:bg-sky-950/50 transition-colors">
                <span className="text-xs text-sky-700 dark:text-sky-300">⏳ Чакат одобрение:</span>
                <span className="text-sm font-semibold text-sky-800 dark:text-sky-200">{pendingTotal}</span>
              </a>
            )}
          </div>
        )}

        {/* Hint за служители БЕЗ staff запис — нямат как да заявят.
            Показваме името на потребителя, за да види admin какъв lookup правим. */}
        {!myStaff && !isAdmin && (
          <div className="mt-2 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 rounded border border-amber-200 dark:border-amber-800">
            Профилът ти („{user?.full_name ?? '—'}") не е свързан със служител в Персонал.
            Admin трябва да добави запис с точно същото име в Персонал.
          </div>
        )}

        {/* Легенда — типове отсъствия. */}
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          {ABSENCE_TYPES.map(t => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <span className={`inline-block w-3 h-3 rounded ${ABSENCE_TYPE_COLORS[t]}`} />
              {ABSENCE_TYPE_LABELS[t]}
            </span>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        {/* Inner wrapper с width: max-content — заемa точно колкото е
            таблицата. Без minWidth 100% → когато viewport е по-широк от
            календара, контейнерът НЕ се разтяга до края на екрана. */}
        <div style={{ width: 'max-content' }}>
        <table className="text-xs border-collapse" style={{ minWidth: 200 + daysCount * 28 + 'px' }}>
          <thead className="sticky top-0 z-20 bg-navy text-white">
            <tr>
              <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider min-w-[200px] sticky left-0 z-30 bg-navy border-r border-navy-light">Служител</th>
              {days.map(d => {
                const dow = new Date(year, month - 1, d).getDay()
                const isWeekend = dow === 0 || dow === 6
                const isToday = isViewingThisMonth && d === todayDay
                return (
                  <th key={d} className={`text-center px-0 py-1 font-medium border-r border-navy-light/50 ${isToday ? 'bg-amber-500 text-navy dark:text-foreground' : isWeekend ? 'bg-navy/80' : ''}`} style={{ minWidth: 28 }}>
                    <div className="leading-tight">
                      <div className="text-[10px] opacity-60">{WEEKDAY_SHORT[dow]}</div>
                      <div className={`text-[11px] ${isToday ? 'font-bold' : ''}`}>{d}</div>
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {/* Ред „Събития" — НАД списъка със служители. Click → отваря
                модал за редакция (admin). Многодневни събития показват
                title-а във всеки покрит ден. */}
            <tr className="border-b-2 border-border bg-muted/30">
              <td className="px-3 py-1.5 font-semibold text-[11px] uppercase tracking-wider sticky left-0 z-10 bg-muted/30 border-r border-border text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" />
                  Събития
                </div>
              </td>
              {days.map(d => {
                const dateIso = iso(year, month, d)
                const dayEvents = eventsForDay(dateIso)
                const first = dayEvents[0]
                const color = first ? EVENT_TYPE_COLORS[first.type as EventType] ?? 'bg-gray-500 text-white' : ''
                const formatEventTime = (e: CompanyEvent) => e.start_time
                  ? `${e.start_time.slice(0, 5)}${e.end_time ? '-' + e.end_time.slice(0, 5) : ''}`
                  : 'цял ден'
                const tooltip = dayEvents.length === 0 ? ''
                  : dayEvents.map(e =>
                      `${EVENT_TYPE_LABELS[e.type as EventType] ?? e.type}: ${e.title}\n${formatEventTime(e)}${e.description ? '\n' + e.description : ''}`,
                    ).join('\n———\n')
                const firstTime = first ? formatEventTime(first) : ''
                return (
                  <td
                    key={d}
                    onClick={() => {
                      if (first && canEditEvents) setEventModal({ existing: first })
                      else if (canEditEvents) setEventModal({ defaultDate: dateIso })
                      setSelectedDay(dateIso)
                    }}
                    title={tooltip}
                    className={`relative text-center border-r border-border/40 ${first ? color : ''} ${canEditEvents ? 'cursor-pointer hover:ring-1 hover:ring-primary/40' : ''}`}
                    style={{ height: 28 }}
                  >
                    {first && (
                      <div className="leading-tight px-0.5">
                        {first.start_time && (
                          <div className="text-[8px] opacity-80 leading-none">{firstTime}</div>
                        )}
                        <div className="text-[9px] font-medium truncate leading-none">{first.title}</div>
                      </div>
                    )}
                    {dayEvents.length > 1 && (
                      <span className="absolute top-0 right-0.5 text-[8px] opacity-80">+{dayEvents.length - 1}</span>
                    )}
                  </td>
                )
              })}
            </tr>
            {staff.length === 0 ? (
              <tr>
                <td colSpan={1 + daysCount} className="text-center py-12 text-muted-foreground">
                  Няма активни служители.
                </td>
              </tr>
            ) : staff.map((s, i) => {
              const isMyRow = myStaff?.id === s.id
              const evenBg = i % 2 === 0 ? 'bg-card' : 'bg-muted/20'
              // Подчертаваме собствения ред със светъл sky-фон → очевидно
              // на служителя кой е неговият ред.
              const rowBg = isMyRow ? 'bg-sky-50 dark:bg-sky-950/30' : evenBg
              return (
                <tr key={s.id} className={`border-b border-border ${rowBg}`}>
                  <td className={`px-3 py-1 font-medium sticky left-0 z-10 ${rowBg} border-r border-border whitespace-nowrap`}>
                    {s.full_name}
                    {s.position && (
                      <span className="ml-1 text-[10px] text-muted-foreground">· {s.position}</span>
                    )}
                    {isMyRow && (
                      <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-sky-500 text-white">ТИ</span>
                    )}
                  </td>
                  {days.map(d => {
                    const dateIso = iso(year, month, d)
                    const dow = new Date(year, month - 1, d).getDay()
                    const isWeekend = dow === 0 || dow === 6
                    const isToday = dateIso === todayIso
                    const abs = findAbsenceForDay(visibleAbsences, s.id, dateIso)
                    const color = abs ? ABSENCE_TYPE_COLORS[abs.type as AbsenceType] ?? 'bg-gray-400 text-white' : ''
                    // Pending → пунктирана рамка + opacity. Rejected → diagonal strip + ред е сив.
                    const isPending = abs?.status === 'pending'
                    const isRejected = abs?.status === 'rejected'
                    const rowEditable = canEditRow(s.id)
                    const statusBadge = abs ? (isPending ? '⏳' : isRejected ? '✗' : '') : ''
                    return (
                      <td
                        key={d}
                        onClick={() => openCell(s.id, s.full_name, dateIso)}
                        title={abs
                          ? `${ABSENCE_TYPE_LABELS[abs.type as AbsenceType] ?? abs.type}${abs.notes ? ': ' + abs.notes : ''} (${formatDate(abs.start_date)} → ${formatDate(abs.end_date)}) — ${
                              isPending ? 'чака одобрение' : isRejected ? 'отказана' : 'одобрена'
                            }${isRejected && abs.rejection_reason ? ' — ' + abs.rejection_reason : ''}`
                          : (rowEditable ? `Добави отсъствие за ${s.full_name}` : '')}
                        className={`border-r border-border/40 text-center align-middle ${isToday ? 'bg-amber-100/60 dark:bg-amber-950/40' : isWeekend && !abs ? 'bg-muted/40' : ''} ${rowEditable ? 'cursor-pointer hover:ring-1 hover:ring-primary/40' : ''}`}
                        style={{ height: 28 }}
                      >
                        {abs && (
                          <div
                            className={`w-full h-full flex items-center justify-center ${color} ${
                              isPending ? 'opacity-50 border border-dashed border-white' : isRejected ? 'opacity-40 line-through' : ''
                            }`}
                          >
                            <span className="text-[10px] font-semibold">
                              {statusBadge || (ABSENCE_TYPE_LABELS[abs.type as AbsenceType]?.slice(0, 1) ?? '·')}
                            </span>
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {/* 2 празни „дишащи" реда между последния служител и
                секция Новини — височина 28px, колкото е и редът. */}
            <tr className="border-b border-transparent"><td colSpan={1 + daysCount} style={{ height: 28 }} /></tr>
            <tr className="border-b border-transparent"><td colSpan={1 + daysCount} style={{ height: 28 }} /></tr>
          </tbody>
        </table>

        {/* Секция Новини — наследява max-content широчината от родителя. */}
        <NewsSection
          news={news}
          canEdit={canEditEvents}
          onAdd={() => setNewsModal({})}
          onEdit={(n) => setNewsModal({ existing: n })}
        />
        </div>
      </div>

      {modal && (
        <AbsenceModal
          staffId={modal.staffId}
          staffName={modal.staffName}
          existing={modal.existing}
          defaultDate={modal.defaultDate}
          isAdmin={isAdmin}
          allAbsences={absences}
          onClose={() => setModal(null)}
          onSaved={async () => { await invalidateAbsences(year); setModal(null) }}
          userId={user?.id}
        />
      )}

      {eventModal && (
        <EventModal
          existing={eventModal.existing}
          defaultDate={eventModal.defaultDate ?? selectedDay}
          onClose={() => setEventModal(null)}
          onSaved={async () => { await invalidateEvents(year); setEventModal(null) }}
          userId={user?.id}
        />
      )}

      {newsModal && (
        <NewsModal
          existing={newsModal.existing}
          onClose={() => setNewsModal(null)}
          onSaved={async () => { await invalidateNews(); setNewsModal(null) }}
          userId={user?.id}
          authorName={user?.full_name ?? null}
        />
      )}
    </div>
  )
}

// ============================================================
// Modal: Добави / редактирай отсъствие
// ============================================================

// Лимит дистанционна работа per месец per служител (без admin одобрение
// сверх). Admin може да добавя без ограничение, тъй като той сам одобрява.
const REMOTE_LIMIT_PER_MONTH = 2

function AbsenceModal({
  staffId, staffName, existing, defaultDate, isAdmin, allAbsences, onClose, onSaved, userId,
}: {
  staffId: string
  staffName: string
  existing?: Absence
  defaultDate?: string
  isAdmin: boolean
  allAbsences: Absence[]
  onClose: () => void
  onSaved: () => Promise<void>
  userId?: string
}) {
  const [start, setStart] = useState(existing?.start_date ?? defaultDate ?? '')
  const [end, setEnd] = useState(existing?.end_date ?? defaultDate ?? '')
  const [type, setType] = useState<AbsenceType>((existing?.type as AbsenceType) ?? 'vacation')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [saving, setSaving] = useState(false)

  // Признак за съществуващ запис: вече одобрен/отказан → можем да го пуснем
  // back to pending само за admin (за реалност, не за служител).
  const existingStatus = existing?.status

  // ESC за затваряне.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const canSave = start && end && start <= end && !saving

  // Лимит за дистанционна работа: служителят не може да заявява повече от
  // 2 работни дни/месец без admin одобрение. Admin (auto-approved) е свободен.
  // Existing approved/pending записи на същия служител се броят към лимита.
  function checkRemoteLimit(): string | null {
    if (isAdmin || type !== 'remote') return null
    const a = new Date(start + 'T00:00:00')
    const b = new Date(end + 'T00:00:00')
    if (isNaN(a.getTime()) || isNaN(b.getTime()) || a > b) return null
    // Списък от уникалните (year, month) комбинации, които range-ът покрива.
    const months: { year: number; month: number }[] = []
    const cur = new Date(a)
    while (cur <= b) {
      const ym = { year: cur.getFullYear(), month: cur.getMonth() + 1 }
      if (!months.some(m => m.year === ym.year && m.month === ym.month)) months.push(ym)
      cur.setMonth(cur.getMonth() + 1)
    }
    for (const { year, month } of months) {
      const newDays = workingDaysInMonth(start, end, year, month)
      let existingDays = 0
      allAbsences.forEach(abs => {
        if (abs.staff_id !== staffId) return
        if (abs.type !== 'remote') return
        if (abs.status === 'rejected') return
        if (existing && abs.id === existing.id) return  // не брой собствения запис
        existingDays += workingDaysInMonth(abs.start_date, abs.end_date, year, month)
      })
      if (newDays + existingDays > REMOTE_LIMIT_PER_MONTH) {
        const monthName = ['Януари','Февруари','Март','Април','Май','Юни','Юли','Август','Септември','Октомври','Ноември','Декември'][month - 1]
        return `Превишаваш лимита за дистанционна работа: ${REMOTE_LIMIT_PER_MONTH} работни дни в ${monthName} ${year}. Вече имаш ${existingDays}, заявяваш още ${newDays}. Помоли admin да добави ръчно.`
      }
    }
    return null
  }

  const save = async () => {
    const limitError = checkRemoteLimit()
    if (limitError) {
      toast.error(limitError)
      return
    }
    setSaving(true)
    try {
      if (existing) {
        await updateAbsence(existing.id, { start_date: start, end_date: end, type, notes: notes || null })
      } else {
        // Admin → одобрено директно; всички останали → чакаща заявка.
        await addAbsence({
          staff_id: staffId,
          start_date: start,
          end_date: end,
          type,
          notes: notes || null,
          status: isAdmin ? 'approved' : 'pending',
          approved_by: isAdmin ? (userId ?? null) : null,
        }, userId)
      }
      toast.success(
        existing
          ? 'Записът е обновен'
          : isAdmin ? 'Отсъствието е добавено' : 'Заявката е изпратена за одобрение',
      )
      await onSaved()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
    } finally {
      setSaving(false)
    }
  }

  const approve = async () => {
    if (!existing || !userId) return
    setSaving(true)
    try {
      await approveAbsence(existing.id, userId)
      toast.success('Заявката е одобрена')
      await onSaved()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка')
    } finally {
      setSaving(false)
    }
  }

  const reject = async () => {
    if (!existing || !userId) return
    const reason = prompt('Причина за отказ (незадължително):') ?? ''
    setSaving(true)
    try {
      await rejectAbsence(existing.id, userId, reason || null)
      toast.success('Заявката е отказана')
      await onSaved()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!existing) return
    if (!confirm('Да изтрия този запис?')) return
    setSaving(true)
    try {
      await deleteAbsence(existing.id)
      toast.success('Записът е изтрит')
      await onSaved()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <h3 className="font-semibold text-foreground">
              {existing ? 'Отсъствие' : (isAdmin ? 'Добави отсъствие' : 'Заявка за отсъствие')}
            </h3>
            <p className="text-xs text-muted-foreground">{staffName}</p>
            {existingStatus && (
              <p className="text-[11px] mt-0.5">
                {existingStatus === 'pending' && <span className="text-amber-700 dark:text-amber-400">⏳ Чака одобрение</span>}
                {existingStatus === 'approved' && <span className="text-emerald-700 dark:text-emerald-400">✓ Одобрена</span>}
                {existingStatus === 'rejected' && (
                  <span className="text-red-700 dark:text-red-400">✗ Отказана{existing?.rejection_reason ? ` — ${existing.rejection_reason}` : ''}</span>
                )}
              </p>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">От</label>
              <input
                type="date"
                value={start}
                onChange={e => { setStart(e.target.value); if (!end || end < e.target.value) setEnd(e.target.value) }}
                className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none"
              />
              {start && <p className="text-[10px] text-muted-foreground mt-0.5">{formatDate(start)}</p>}
            </div>
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">До</label>
              <input
                type="date"
                value={end}
                min={start}
                onChange={e => setEnd(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none"
              />
              {end && <p className="text-[10px] text-muted-foreground mt-0.5">{formatDate(end)}</p>}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1.5">Тип</label>
            <div className="flex flex-wrap gap-1.5">
              {ABSENCE_TYPES.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`px-2.5 py-1 text-xs rounded border transition-all ${
                    type === t
                      ? `${ABSENCE_TYPE_COLORS[t]} border-transparent ring-2 ring-offset-1 ring-current/30`
                      : 'bg-background border-border text-muted-foreground hover:bg-muted/30'
                  }`}
                >
                  {ABSENCE_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Бележка</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="незадължително"
              className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-border gap-2">
          {existing ? (
            <Button variant="ghost" className="text-destructive" onClick={remove} disabled={saving}>
              <Trash2 className="h-3.5 w-3.5" />
              Изтрий
            </Button>
          ) : <span />}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* За admin при чакаща заявка → допълнителни бутони. */}
            {isAdmin && existing && existingStatus === 'pending' && (
              <>
                <Button variant="destructive" onClick={reject} disabled={saving}>Откажи</Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={approve} disabled={saving}>Одобри</Button>
              </>
            )}
            <Button variant="ghost" onClick={onClose} disabled={saving}>Отказ</Button>
            <Button onClick={save} disabled={!canSave}>
              {existing
                ? 'Запиши'
                : <><Plus className="h-3.5 w-3.5" />{isAdmin ? 'Добави' : 'Заяви'}</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Modal: Добави / редактирай фирмено събитие
// ============================================================
function EventModal({
  existing, defaultDate, onClose, onSaved, userId,
}: {
  existing?: CompanyEvent
  defaultDate: string
  onClose: () => void
  onSaved: () => Promise<void>
  userId?: string
}) {
  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [startDate, setStartDate] = useState(existing?.start_date ?? defaultDate)
  const [endDate, setEndDate] = useState(existing?.end_date ?? defaultDate)
  const [allDay, setAllDay] = useState(existing ? !existing.start_time : true)
  const [startTime, setStartTime] = useState(existing?.start_time?.slice(0, 5) ?? '09:00')
  const [endTime, setEndTime] = useState(existing?.end_time?.slice(0, 5) ?? '10:00')
  const [type, setType] = useState<EventType>((existing?.type as EventType) ?? 'meeting')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const canSave = title.trim() && startDate && endDate && startDate <= endDate && !saving

  async function save() {
    setSaving(true)
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        start_date: startDate,
        end_date: endDate,
        start_time: allDay ? null : startTime + ':00',
        end_time: allDay ? null : endTime + ':00',
        type,
      }
      if (existing) {
        await updateEvent(existing.id, payload)
      } else {
        await addEvent(payload, userId)
      }
      toast.success(existing ? 'Събитието е обновено' : 'Събитието е добавено')
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
      await deleteEvent(existing.id)
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
      <div className="bg-card rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-foreground">{existing ? 'Редактирай събитие' : 'Ново събитие'}</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Заглавие</label>
            <input
              type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Тиймбилдинг, Среща, ..." autoFocus
              className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1.5">Тип</label>
            <div className="flex flex-wrap gap-1.5">
              {EVENT_TYPES.map(t => (
                <button
                  key={t} type="button" onClick={() => setType(t)}
                  className={`px-2.5 py-1 text-xs rounded border transition-all ${
                    type === t
                      ? `${EVENT_TYPE_COLORS[t]} border-transparent ring-2 ring-offset-1 ring-current/30`
                      : 'bg-background border-border text-muted-foreground hover:bg-muted/30'
                  }`}
                >
                  {EVENT_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">От</label>
              <input
                type="date" value={startDate}
                onChange={e => { setStartDate(e.target.value); if (!endDate || endDate < e.target.value) setEndDate(e.target.value) }}
                className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none"
              />
              {startDate && <p className="text-[10px] text-muted-foreground mt-0.5">{formatDate(startDate)}</p>}
            </div>
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">До</label>
              <input
                type="date" value={endDate} min={startDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none"
              />
              {endDate && <p className="text-[10px] text-muted-foreground mt-0.5">{formatDate(endDate)}</p>}
            </div>
          </div>

          <div>
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} className="h-3.5 w-3.5" />
              Цял ден
            </label>
            {!allDay && (
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">Начало</label>
                  <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">Край</label>
                  <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none" />
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Описание</label>
            <textarea
              value={description} onChange={e => setDescription(e.target.value)}
              placeholder="място, програма, бележки..."
              rows={2}
              className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none resize-y"
            />
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-border gap-2">
          {existing ? (
            <Button variant="ghost" className="text-destructive" onClick={remove} disabled={saving}>
              <Trash2 className="h-3.5 w-3.5" /> Изтрий
            </Button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>Отказ</Button>
            <Button onClick={save} disabled={!canSave}>
              {existing ? <><Pencil className="h-3.5 w-3.5" />Запиши</> : <><Plus className="h-3.5 w-3.5" />Добави</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Секция Новини — под Календара
// ============================================================
function NewsSection({
  news, canEdit, onAdd, onEdit,
}: {
  news: NewsItem[]
  canEdit: boolean
  onAdd: () => void
  onEdit: (n: NewsItem) => void
}) {
  const visible = news.slice(0, 15)

  return (
    <div className="border-t border-border bg-card px-3 md:px-5 py-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Newspaper className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">Новини</span>
          <span className="text-[11px] text-muted-foreground">
            {news.length === 0 ? 'все още няма' : `${news.length}`}
          </span>
        </div>
        {canEdit && (
          <Button size="sm" variant="ghost" className="h-7" onClick={onAdd}>
            <Plus className="h-3 w-3" /> Нова
          </Button>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-2">Все още няма публикувани новини.</p>
      ) : (
        // До 3 карти на ред (responsive: 1 на телефон, 2 на среден екран).
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {visible.map(n => {
            const color = NEWS_TYPE_COLORS[n.type as NewsType] ?? NEWS_TYPE_COLORS.general
            const icon = NEWS_TYPE_ICONS[n.type as NewsType] ?? '📰'
            const label = NEWS_TYPE_LABELS[n.type as NewsType] ?? n.type
            return (
              <div
                key={n.id}
                className={`relative rounded-md border px-2.5 py-1.5 ${color} ${canEdit ? 'cursor-pointer hover:opacity-90' : ''}`}
                onClick={() => canEdit && onEdit(n)}
                title={canEdit ? 'Клик за редакция' : ''}
              >
                {n.pinned && (
                  <Pin className="h-3 w-3 absolute top-1 right-1 opacity-70" />
                )}
                <div className="flex items-center gap-1.5 text-[10px] uppercase opacity-80 mb-0.5">
                  <span>{icon}</span>
                  <span>{label}</span>
                </div>
                <div className="text-xs font-semibold leading-tight">{n.title}</div>
                {n.body && (
                  <div className="text-[11px] opacity-90 leading-tight mt-0.5 whitespace-pre-wrap line-clamp-3">{n.body}</div>
                )}
                <div className="text-[9px] opacity-70 mt-1 flex items-center gap-1.5">
                  {n.author_name && <span>{n.author_name}</span>}
                  <span>·</span>
                  <span>{formatDateTime(n.created_at)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Modal: Нова / редактирай новина
// ============================================================
function NewsModal({
  existing, onClose, onSaved, userId, authorName,
}: {
  existing?: NewsItem
  onClose: () => void
  onSaved: () => Promise<void>
  userId?: string
  authorName: string | null
}) {
  const [title, setTitle] = useState(existing?.title ?? '')
  const [body, setBody] = useState(existing?.body ?? '')
  const [type, setType] = useState<NewsType>((existing?.type as NewsType) ?? 'general')
  const [pinned, setPinned] = useState(existing?.pinned ?? false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const canSave = title.trim() && !saving

  async function save() {
    setSaving(true)
    try {
      if (existing) {
        await updateNews(existing.id, { title: title.trim(), body: body.trim() || null, type, pinned })
      } else {
        await addNews({ title: title.trim(), body: body.trim() || null, type, pinned, author_name: authorName }, userId)
      }
      toast.success(existing ? 'Новината е обновена' : 'Публикувано')
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
      await deleteNews(existing.id)
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
      <div className="bg-card rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-foreground">{existing ? 'Редактирай новина' : 'Нова новина'}</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1.5">Тип</label>
            <div className="flex flex-wrap gap-1.5">
              {NEWS_TYPES.map(t => (
                <button
                  key={t} type="button" onClick={() => setType(t)}
                  className={`px-2.5 py-1 text-xs rounded border transition-all ${
                    type === t
                      ? `${NEWS_TYPE_COLORS[t]} ring-2 ring-offset-1 ring-current/30`
                      : 'bg-background border-border text-muted-foreground hover:bg-muted/30'
                  }`}
                >
                  {NEWS_TYPE_ICONS[t]} {NEWS_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Заглавие</label>
            <input
              type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Кратко и ясно" autoFocus
              className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Описание</label>
            <textarea
              value={body} onChange={e => setBody(e.target.value)}
              placeholder="Подробности — незадължително"
              rows={4}
              className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:border-primary focus:outline-none resize-y"
            />
          </div>

          <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} className="h-3.5 w-3.5" />
            <Pin className="h-3 w-3" />
            Закачи отгоре
          </label>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-border gap-2">
          {existing ? (
            <Button variant="ghost" className="text-destructive" onClick={remove} disabled={saving}>
              <Trash2 className="h-3.5 w-3.5" /> Изтрий
            </Button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>Отказ</Button>
            <Button onClick={save} disabled={!canSave}>
              {existing ? <><Pencil className="h-3.5 w-3.5" />Запиши</> : <><Plus className="h-3.5 w-3.5" />Публикувай</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
