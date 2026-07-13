import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Navigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '../lib/auth'
import {
  useStaff, useAbsences, useForm76Overrides, useInvalidateCrm,
} from '../lib/queries'
import { setForm76Override } from '../lib/storage'
import { exportRowsToExcel } from '../lib/export'
import { useMyStaff } from '../lib/useMyStaff'
import {
  ABSENCE_TYPE_TO_FORM76_CODE,
  FORM76_CODES, FORM76_CODE_LABELS, FORM76_CODE_COLORS,
  type Absence, type Form76Override,
} from '../lib/types'

const MONTH_NAMES = [
  'Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни',
  'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември',
]

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

// За даден ден и служител връща ОДОБРЕНОТО absence (или null).
function findAbsenceForDay(absences: Absence[], staffId: string, year: number, month: number, day: number): Absence | null {
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  for (const a of absences) {
    if (a.staff_id !== staffId) continue
    if (a.status !== 'approved') continue
    if (iso >= a.start_date && iso <= a.end_date) return a
  }
  return null
}

// Изчислява каква СТОЙНОСТ да покажем в клетка (default или override).
// default: уикенд = '', работен ден + няма абсенс = '8', има абсенс = код по тип
//
// Termination propagation: ако в по-ранен ден от месеца има override '-'
// (прекратен договор), всички следващи дни default-ват към '-' — освен ако
// конкретният ден няма свой override.
function computeCellValue(
  absences: Absence[],
  overridesIdx: Map<string, string>,
  staffId: string,
  year: number, month: number, day: number,
): string {
  const key = `${staffId}|${day}`
  const override = overridesIdx.get(key)
  if (override !== undefined) return override
  // Default — провери първо за прекратяване в предходен ден.
  for (let d = 1; d < day; d++) {
    if (overridesIdx.get(`${staffId}|${d}`) === '-') return '-'
  }
  const dow = new Date(year, month - 1, day).getDay()
  const isWeekend = dow === 0 || dow === 6
  if (isWeekend) return ''
  const abs = findAbsenceForDay(absences, staffId, year, month, day)
  if (abs) return ABSENCE_TYPE_TO_FORM76_CODE[abs.type as string] ?? 'Н'
  return '8'
}

export function Form76Page() {
  const { user } = useAuth()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const staffQ = useStaff()
  const absencesQ = useAbsences(year)
  const overridesQ = useForm76Overrides(year, month)
  const { invalidateForm76Overrides } = useInvalidateCrm()

  // Достъп — admin или ТРЗ.
  const allStaff = useMemo(() => (staffQ.data ?? []), [staffQ.data])
  const { myStaff, isAdmin } = useMyStaff()
  const canSee = isAdmin || myStaff?.department === 'ТРЗ'

  const staff = useMemo(() => allStaff.filter(s => s.is_active), [allStaff])
  const absences = useMemo(() => absencesQ.data ?? [], [absencesQ.data])
  const overrides = useMemo(() => overridesQ.data ?? [], [overridesQ.data])
  const overridesIdx = useMemo(() => {
    const m = new Map<string, string>()
    overrides.forEach((o: Form76Override) => m.set(`${o.staff_id}|${o.day}`, o.value))
    return m
  }, [overrides])

  const dCount = daysInMonth(year, month)
  const days = useMemo(() => Array.from({ length: dCount }, (_, i) => i + 1), [dCount])

  // Общи дни в месеца — работни дни.
  const workingDaysTotal = useMemo(() => {
    let c = 0
    for (let d = 1; d <= dCount; d++) {
      const dow = new Date(year, month - 1, d).getDay()
      if (dow !== 0 && dow !== 6) c++
    }
    return c
  }, [year, month, dCount])

  // Активна клетка за редакция: показваме popover до нея.
  const [editingCell, setEditingCell] = useState<{ staffId: string; day: number } | null>(null)

  const handleCellClick = useCallback((staffId: string, day: number) => {
    setEditingCell({ staffId, day })
  }, [])

  const handleSetValue = useCallback(async (value: string | null) => {
    if (!editingCell) return
    const { staffId, day } = editingCell
    try {
      await setForm76Override(staffId, year, month, day, value, user?.id)
      await invalidateForm76Overrides(year, month)
      // Затваряме popover-а САМО при успех — при грешка остава отворен,
      // за да може потребителят да опита пак, без да губи избора си.
      setEditingCell(null)
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис — опитай отново')
    }
  }, [editingCell, year, month, user?.id, invalidateForm76Overrides])

  // ESC за затваряне на popover-а.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditingCell(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const goPrev = () => { if (month === 1) { setYear(year - 1); setMonth(12) } else setMonth(month - 1) }
  const goNext = () => { if (month === 12) { setYear(year + 1); setMonth(1) } else setMonth(month + 1) }
  const goToday = () => { const t = new Date(); setYear(t.getFullYear()); setMonth(t.getMonth() + 1) }
  const isViewingThisMonth = year === now.getFullYear() && month === now.getMonth() + 1
  const todayDay = now.getDate()

  // ============================================================
  // Изчисление на summary колоните за всеки служител (агрегат на стойностите).
  // ============================================================
  type Summary = {
    hours: number   // Σ часове
    daysWorked: number  // дни „8"
    vacation: number    // О
    sick: number        // Б
    maternity: number   // М
    business: number    // К
    study: number       // У
    unpaid: number      // Н
    weekendDays: number // почивни
  }
  const summaryByStaff = useMemo(() => {
    const m = new Map<string, Summary>()
    staff.forEach(s => {
      const sum: Summary = { hours: 0, daysWorked: 0, vacation: 0, sick: 0, maternity: 0, business: 0, study: 0, unpaid: 0, weekendDays: 0 }
      for (let d = 1; d <= dCount; d++) {
        const v = computeCellValue(absences, overridesIdx, s.id, year, month, d)
        const dow = new Date(year, month - 1, d).getDay()
        const isWeekend = dow === 0 || dow === 6
        if (v === '8') { sum.hours += 8; sum.daysWorked += 1 }
        else if (v === '4') { sum.hours += 4; sum.daysWorked += 0.5 }
        else if (v === 'О') sum.vacation += 1
        else if (v === 'Б') sum.sick += 1
        else if (v === 'М') sum.maternity += 1
        else if (v === 'К') sum.business += 1
        else if (v === 'У') sum.study += 1
        else if (v === 'Н') sum.unpaid += 1
        if (isWeekend) sum.weekendDays += 1
      }
      m.set(s.id, sum)
    })
    return m
  }, [staff, absences, overridesIdx, year, month, dCount])

  // ============================================================
  // Експорт към Excel — точно това, което се вижда + summary колоните.
  // ============================================================
  const exportExcel = useCallback(async () => {
    const headers = [
      'Име, презиме, фамилия', 'Длъжност',
      ...days.map(d => String(d)),
      'Общо часове', 'Дни работа',
      'Отпуск', 'Болничен', 'Майчинство', 'Командировка', 'Учебен/Адм.', 'Неплатен',
      'Почивни',
    ]
    const rows = staff.map(s => {
      const cells: string[] = []
      for (let d = 1; d <= dCount; d++) {
        cells.push(computeCellValue(absences, overridesIdx, s.id, year, month, d))
      }
      const sum = summaryByStaff.get(s.id)!
      return [
        s.full_name, s.position ?? s.department ?? '',
        ...cells,
        String(sum.hours), String(sum.daysWorked),
        String(sum.vacation), String(sum.sick), String(sum.maternity),
        String(sum.business), String(sum.study), String(sum.unpaid),
        String(sum.weekendDays),
      ] as (string | number)[]
    })
    const monthLabel = MONTH_NAMES[month - 1]
    await exportRowsToExcel({
      headers,
      rows,
      sheetName: `${monthLabel} ${year}`.slice(0, 31),
      fileName: `Форма76_${monthLabel}_${year}.xlsx`,
    })
    toast.success(`Форма 76 за ${monthLabel} ${year} е готова`)
  }, [staff, days, dCount, absences, overridesIdx, summaryByStaff, year, month])

  if (!canSee) return <Navigate to="/" replace />

  const ready = !!staffQ.data && !!absencesQ.data && !!overridesQ.data
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
    <div className="flex flex-col h-[calc(100vh-3rem)] md:h-screen">
      {/* Header */}
      <div className="px-3 py-2 md:px-5 md:py-3 border-b border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
            <div>
              <h1 className="text-base md:text-lg font-semibold text-foreground">Форма 76 — отчитане явяване/неявяване</h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                По подразбиране 8 за работен ден + код от календара. Клик на клетка → override.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 border border-border rounded-md bg-background">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goPrev}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="px-2 text-sm font-semibold whitespace-nowrap">{MONTH_NAMES[month - 1]} {year}</span>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goNext}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <Button variant="outline" size="sm" onClick={goToday} title="Към текущия месец" disabled={isViewingThisMonth}>Днес</Button>
            <div className="text-xs text-muted-foreground whitespace-nowrap">
              {workingDaysTotal} раб. дни · {workingDaysTotal * 8} часа
            </div>
            <Button variant="outline" size="sm" onClick={exportExcel} title="Експорт към Excel">
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Експорт</span>
            </Button>
          </div>
        </div>

        {/* Легенда */}
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          {(['8', '4', 'О', 'Б', 'М', 'К', 'У', 'Н', '-'] as const).map(c => (
            <span key={c} className="inline-flex items-center gap-1.5">
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-semibold border border-border ${FORM76_CODE_COLORS[c]}`}>{c}</span>
              {FORM76_CODE_LABELS[c].replace(/^[^\s—]+\s—\s/, '')}
            </span>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        <table className="text-xs border-collapse" style={{ minWidth: 220 + dCount * 28 + 9 * 60 + 'px' }}>
          <thead className="sticky top-0 z-20 bg-navy text-white">
            <tr>
              <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider min-w-[180px] sticky left-0 z-30 bg-navy border-r border-navy-light">Име</th>
              <th className="text-left px-2 py-2 font-semibold uppercase tracking-wider min-w-[120px] border-r border-navy-light">Длъжност</th>
              {days.map(d => {
                const dow = new Date(year, month - 1, d).getDay()
                const isWeekend = dow === 0 || dow === 6
                const isToday = isViewingThisMonth && d === todayDay
                return (
                  <th key={d} className={`text-center font-medium border-r border-navy-light/50 ${isToday ? 'bg-amber-500 text-navy font-bold' : isWeekend ? 'bg-sky-700' : ''}`} style={{ minWidth: 28 }}>
                    {d}
                  </th>
                )
              })}
              <th className="text-center px-1 py-1 font-semibold uppercase tracking-wider min-w-[55px] border-l border-navy-light" title="Общо часове">Часове</th>
              <th className="text-center px-1 py-1 font-semibold uppercase tracking-wider min-w-[45px]" title="Дни работа">Дни</th>
              <th className="text-center px-1 py-1 font-semibold uppercase tracking-wider min-w-[40px]" title="Редовен отпуск">О</th>
              <th className="text-center px-1 py-1 font-semibold uppercase tracking-wider min-w-[40px]" title="Отпуск по болест">Б</th>
              <th className="text-center px-1 py-1 font-semibold uppercase tracking-wider min-w-[40px]" title="Отпуск по майчинство">М</th>
              <th className="text-center px-1 py-1 font-semibold uppercase tracking-wider min-w-[40px]" title="Командировка / Държ. задължение">К</th>
              <th className="text-center px-1 py-1 font-semibold uppercase tracking-wider min-w-[40px]" title="Учебен / Адмист.">У</th>
              <th className="text-center px-1 py-1 font-semibold uppercase tracking-wider min-w-[40px]" title="Неплатен">Н</th>
              <th className="text-center px-1 py-1 font-semibold uppercase tracking-wider min-w-[50px]" title="Празнични и почивни">Почивни</th>
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 ? (
              <tr><td colSpan={2 + dCount + 9} className="text-center py-12 text-muted-foreground">Няма активни служители.</td></tr>
            ) : staff.map((s, i) => {
              const evenBg = i % 2 === 0 ? 'bg-card' : 'bg-muted/20'
              const sum = summaryByStaff.get(s.id)!
              return (
                <tr key={s.id} className={`border-b border-border ${evenBg}`}>
                  <td className={`px-3 py-1 font-medium sticky left-0 z-10 ${evenBg} border-r border-border whitespace-nowrap`}>{s.full_name}</td>
                  <td className="px-2 py-1 text-muted-foreground border-r border-border whitespace-nowrap text-[11px]">{s.position ?? s.department ?? '—'}</td>
                  {days.map(d => {
                    const dow = new Date(year, month - 1, d).getDay()
                    const isWeekend = dow === 0 || dow === 6
                    const isToday = isViewingThisMonth && d === todayDay
                    const value = computeCellValue(absences, overridesIdx, s.id, year, month, d)
                    const hasOverride = overridesIdx.has(`${s.id}|${d}`)
                    const colorClass = FORM76_CODE_COLORS[value] ?? ''
                    const isEditing = editingCell?.staffId === s.id && editingCell?.day === d
                    return (
                      <td
                        key={d}
                        onClick={() => handleCellClick(s.id, d)}
                        className={`relative text-center cursor-pointer border-r border-border/40 ${isToday ? 'bg-amber-100/60 dark:bg-amber-950/40' : isWeekend ? 'bg-sky-100 dark:bg-sky-950/30' : ''} ${colorClass} ${hasOverride ? 'ring-1 ring-inset ring-primary/50' : ''} hover:ring-1 hover:ring-primary`}
                        style={{ height: 28 }}
                        title={hasOverride ? 'Override (клик за смяна)' : 'Клик за override'}
                      >
                        <span className="text-[11px] font-medium">{value || ''}</span>
                        {isEditing && (
                          <CellEditor
                            currentValue={value}
                            hasOverride={hasOverride}
                            onPick={handleSetValue}
                            onClose={() => setEditingCell(null)}
                          />
                        )}
                      </td>
                    )
                  })}
                  <td className="px-1 py-1 text-center tabular-nums font-semibold border-l border-border">{sum.hours}</td>
                  <td className="px-1 py-1 text-center tabular-nums">{sum.daysWorked}</td>
                  <td className="px-1 py-1 text-center tabular-nums">{sum.vacation || '—'}</td>
                  <td className="px-1 py-1 text-center tabular-nums">{sum.sick || '—'}</td>
                  <td className="px-1 py-1 text-center tabular-nums">{sum.maternity || '—'}</td>
                  <td className="px-1 py-1 text-center tabular-nums">{sum.business || '—'}</td>
                  <td className="px-1 py-1 text-center tabular-nums">{sum.study || '—'}</td>
                  <td className="px-1 py-1 text-center tabular-nums">{sum.unpaid || '—'}</td>
                  <td className="px-1 py-1 text-center tabular-nums text-muted-foreground">{sum.weekendDays}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Popover за избор на стойност на клетка.
function CellEditor({ currentValue, hasOverride, onPick, onClose }: {
  currentValue: string
  hasOverride: boolean
  onPick: (v: string | null) => void
  onClose: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 min-w-[200px] bg-card text-foreground border border-border rounded-md shadow-lg overflow-hidden">
        {FORM76_CODES.map(code => (
          <button
            key={code || 'empty'}
            type="button"
            onClick={() => onPick(code)}
            className={`w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 hover:bg-muted border-b border-border last:border-0 ${currentValue === code ? 'font-semibold' : ''}`}
          >
            <span className={`inline-flex items-center justify-center w-6 h-5 rounded text-[10px] font-semibold ${FORM76_CODE_COLORS[code]}`}>{code || '·'}</span>
            <span>{FORM76_CODE_LABELS[code]}</span>
          </button>
        ))}
        {hasOverride && (
          <button
            type="button"
            onClick={() => onPick(null)}
            className="w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 hover:bg-muted border-t border-border bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Върни към default
          </button>
        )}
      </div>
    </>
  )
}
