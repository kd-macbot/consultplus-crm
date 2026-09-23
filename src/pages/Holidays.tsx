import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Plus, Trash2, CalendarDays, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '../lib/auth'
import { useHolidays, useInvalidateCrm } from '../lib/queries'
import { upsertHoliday, deleteHoliday, insertHolidaysIfMissing } from '../lib/storage'
import { holidaysOfYear, buildWorkCalendar, statutoryHolidays, type Holiday } from '../lib/holidays'
import { workingDaysInMonthTotal } from '../lib/utils'
import { formatDate } from '../lib/utils'

// ============================================================
// Производствен календар (admin).
//
// Официалните празници и разместените дни се обявяват веднъж
// годишно с решение на МС. Тук се въвеждат, за да не иска всяка
// нова година пипане по кода.
// ============================================================

const MONTH_NAMES = [
  'Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни',
  'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември',
]
const DOW = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота']

export function HolidaysPage() {
  const { user } = useAuth()
  const [year, setYear] = useState(new Date().getFullYear())
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [isWorking, setIsWorking] = useState(false)
  const [saving, setSaving] = useState(false)

  const holidaysQ = useHolidays()
  const { invalidateHolidays } = useInvalidateCrm()
  const all = useMemo(() => holidaysQ.data ?? [], [holidaysQ.data])
  const rows = useMemo(() => holidaysOfYear(all, year), [all, year])
  const cal = useMemo(() => buildWorkCalendar(all), [all])

  // Годишният сбор — числото, с което се сверява спрямо
  // производствения календар на НАП/бранша.
  const totals = useMemo(() => {
    const perMonth = Array.from({ length: 12 }, (_, i) => workingDaysInMonthTotal(year, i + 1, cal))
    const days = perMonth.reduce((a, b) => a + b, 0)
    return { perMonth, days, hours: days * 8 }
  }, [year, cal])

  // Какво липсва спрямо закона за избраната година.
  // Показва се само това, което би се ДОБАВИЛО — вече въведените
  // не се броят, за да не пише „12 дни", а да добави нула.
  const missing = useMemo(() => {
    const have = new Set(rows.map(r => r.date))
    return statutoryHolidays(year).filter(h => !have.has(h.date))
  }, [rows, year])

  if (user?.role !== 'admin') return <Navigate to="/" replace />

  async function fillStatutory() {
    if (missing.length === 0) {
      toast.info(`Законовите дни за ${year} вече са въведени`)
      return
    }
    const list = missing.map(h => `  ${formatDate(h.date)}  ${h.name}`).join('\n')
    const ok = confirm(
      `Да се добавят ли ${missing.length} законови дни за ${year}?\n\n${list}\n\n` +
      'Разместванията („мостовете") се обявяват с решение на МС и НЕ следват от закона — ' +
      'тях добави на ръка. Провери годишния сбор срещу производствения календар.',
    )
    if (!ok) return
    setSaving(true)
    try {
      await insertHolidaysIfMissing(missing, {
        userId: user?.id, userName: user?.full_name ?? '',
        label: `${missing.length} законови дни за ${year}`,
      })
      await invalidateHolidays()
      toast.success(`Добавени ${missing.length} дни. Сега сверѝ годишния сбор.`)
    } catch (e) {
      toast.error('Неуспешно добавяне: ' + (e as Error).message)
    } finally { setSaving(false) }
  }

  async function add() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast.error('Избери дата'); return }
    if (!name.trim()) { toast.error('Напиши повода'); return }
    setSaving(true)
    try {
      await upsertHoliday({ date, name: name.trim(), is_working: isWorking },
        { userId: user?.id, userName: user?.full_name ?? '' })
      await invalidateHolidays()
      setDate(''); setName(''); setIsWorking(false)
      toast.success('Записано')
    } catch (e) {
      toast.error('Неуспешен запис: ' + (e as Error).message)
    } finally { setSaving(false) }
  }

  async function remove(h: Holiday) {
    if (!confirm(`Да се изтрие ли „${h.name}" на ${formatDate(h.date)}?`)) return
    try {
      await deleteHoliday(h.date, { userId: user?.id, userName: user?.full_name ?? '', name: h.name })
      await invalidateHolidays()
      toast.success('Изтрито')
    } catch (e) {
      toast.error('Неуспешно изтриване: ' + (e as Error).message)
    }
  }

  const dowOf = (iso: string) => DOW[new Date(iso + 'T00:00:00').getDay()]

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3 flex-wrap">
          <CalendarDays className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Производствен календар</h1>
          <div className="flex items-center gap-1 ml-auto">
            <Button variant="ghost" size="sm" onClick={() => setYear(y => y - 1)} aria-label="Предходна година">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium w-14 text-center">{year}</span>
            <Button variant="ghost" size="sm" onClick={() => setYear(y => y + 1)} aria-label="Следваща година">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline" size="sm" onClick={fillStatutory} disabled={saving}
              title={missing.length === 0
                ? `Законовите дни за ${year} вече са въведени`
                : `Добавя ${missing.length} законови дни за ${year}`}
            >
              <Wand2 className="h-4 w-4 mr-1" />
              Попълни по закон
              {missing.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
                  {missing.length}
                </span>
              )}
            </Button>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Тези дни се вадят от работните при Справка отпуска, Форма 76, заявките и лимита за
          дистанционна работа. Съботите и неделите НЕ се вписват — те и без това не се броят.
          Вписва се само обявена <strong>работна</strong> събота (отработване на мост).
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          <strong>„Попълни по закон"</strong> смята дните от Кодекса на труда — фиксираните дати,
          Великден и заместващите, когато празникът падне в събота или неделя. Вече въведените
          не се пипат. <strong>Разместванията („мостовете") НЕ следват от закона</strong> — обявяват се
          с решение на МС и се добавят на ръка; годишният сбор отдолу ги хваща.
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Сборът — за сверка с производствения календар на бранша. */}
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-sm">
            <span className="font-semibold text-base">{totals.days}</span> работни дни
            {' · '}
            <span className="font-semibold">{totals.hours}</span> часа за {year}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {totals.perMonth.map((d, i) => (
              <span key={i}>{MONTH_NAMES[i].slice(0, 3)} <strong className="text-foreground">{d}</strong></span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Сверявай това число с производствения календар за годината. Разминаване значи,
            че тук липсва или стои излишен ден.
          </p>
        </div>

        {/* Добавяне */}
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Дата</span>
              <input
                type="date" value={date} onChange={e => setDate(e.target.value)}
                className="h-9 px-2 rounded border border-border bg-background text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs flex-1 min-w-[200px]">
              <span className="text-muted-foreground">Повод</span>
              <input
                value={name} onChange={e => setName(e.target.value)}
                placeholder="напр. Ден на Освобождението"
                className="h-9 px-2 rounded border border-border bg-background text-sm w-full"
              />
            </label>
            <label className="flex items-center gap-2 h-9 text-xs">
              <input type="checkbox" checked={isWorking} onChange={e => setIsWorking(e.target.checked)} />
              <span>работен ден (отработване в събота/неделя)</span>
            </label>
            <Button onClick={add} disabled={saving} size="sm">
              <Plus className="h-4 w-4 mr-1" /> Добави
            </Button>
          </div>
        </div>

        {/* Списък */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Няма въведени дни за {year}.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Дата</th>
                  <th className="text-left px-3 py-2">Ден</th>
                  <th className="text-left px-3 py-2">Повод</th>
                  <th className="text-left px-3 py-2">Вид</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map(h => (
                  <tr key={h.date} className="border-t border-border/60">
                    <td className="px-3 py-2 tabular-nums">{formatDate(h.date)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{dowOf(h.date)}</td>
                    <td className="px-3 py-2">{h.name}</td>
                    <td className="px-3 py-2">
                      {h.is_working
                        ? <span className="text-emerald-600 dark:text-emerald-400">работен</span>
                        : <span className="text-rose-600 dark:text-rose-400">неработен</span>}
                    </td>
                    <td className="px-2 py-2">
                      <Button variant="ghost" size="sm" onClick={() => remove(h)} aria-label="Изтрий">
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
