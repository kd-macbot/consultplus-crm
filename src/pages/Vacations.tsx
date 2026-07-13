import { useMemo, useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, FileSpreadsheet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '../lib/auth'
import {
  useStaff, useAbsences, useVacationQuotas, useInvalidateCrm,
} from '../lib/queries'
import { upsertVacationQuota } from '../lib/storage'
import type { Absence, VacationQuota } from '../lib/types'
import { Navigate } from 'react-router-dom'
import { workingDaysInMonth } from '../lib/utils'
import { useMyStaff } from '../lib/useMyStaff'

const MONTHS_SHORT = ['Ян', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек']

// Малък input компонент за inline числено редактиране в клетка.
function NumCell({
  value, onSave, step = 0.5, min = 0, placeholder,
}: {
  value: number | null
  onSave: (v: number | null) => void
  step?: number
  min?: number
  placeholder?: string
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  useEffect(() => { setDraft(value == null ? '' : String(value)) }, [value])
  return (
    <input
      type="number"
      step={step}
      min={min}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        const num = draft.trim() === '' ? null : parseFloat(draft)
        if (num !== value && !(num !== null && isNaN(num))) onSave(num)
      }}
      placeholder={placeholder ?? '0'}
      className="w-16 h-7 px-1.5 text-xs text-right border border-border rounded bg-background focus:border-primary focus:outline-none"
    />
  )
}

export function VacationsPage() {
  const { user } = useAuth()
  const [year, setYear] = useState(new Date().getFullYear())

  const staffQ = useStaff()
  const absencesQ = useAbsences(year)
  const quotasQ = useVacationQuotas(year)
  const { invalidateVacationQuotas } = useInvalidateCrm()

  const staff = useMemo(() => (staffQ.data ?? []).filter(s => s.is_active), [staffQ.data])
  const absences: Absence[] = useMemo(() => absencesQ.data ?? [], [absencesQ.data])
  const quotas = useMemo(() => quotasQ.data ?? [], [quotasQ.data])

  // Достъп — admin или ТРЗ отдел. (Това е финансова справка.)
  const { myStaff, isAdmin } = useMyStaff()
  const canSee = isAdmin || myStaff?.department === 'ТРЗ'

  const quotaByStaff = useMemo(() => {
    const m = new Map<string, VacationQuota>()
    quotas.forEach(q => m.set(q.staff_id, q))
    return m
  }, [quotas])

  // Използвани дни per (staff × месец) — само от тип vacation, само одобрени.
  const usedByStaffMonth = useMemo(() => {
    const m = new Map<string, Map<number, number>>()  // staff_id → month → days
    absences.forEach(a => {
      if (a.type !== 'vacation' || a.status !== 'approved') return
      let inner = m.get(a.staff_id)
      if (!inner) { inner = new Map(); m.set(a.staff_id, inner) }
      for (let mo = 1; mo <= 12; mo++) {
        const days = workingDaysInMonth(a.start_date, a.end_date, year, mo)
        if (days > 0) inner.set(mo, (inner.get(mo) ?? 0) + days)
      }
    })
    return m
  }, [absences, year])

  // Σ използвани за годината — сборува сумата по месеците (равно на
  // workingDaysInYear, но дава консистентност с виждащото се в редовете).
  const usedTotalByStaff = useMemo(() => {
    const m = new Map<string, number>()
    usedByStaffMonth.forEach((months, staffId) => {
      let total = 0
      months.forEach(d => total += d)
      m.set(staffId, total)
    })
    return m
  }, [usedByStaffMonth])

  const saveQuota = useCallback(async (staffId: string, patch: Partial<VacationQuota>) => {
    try {
      await upsertVacationQuota(staffId, year, patch, user?.id)
      await invalidateVacationQuotas(year)
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
    }
  }, [year, user?.id, invalidateVacationQuotas])

  const ready = !!staffQ.data && !!absencesQ.data && !!quotasQ.data

  if (!canSee) {
    return <Navigate to="/" replace />
  }

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
              <h1 className="text-base md:text-lg font-semibold text-foreground">Справка за отпуска</h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Оставащ = От минали години + За тек. година + Доп. − Σ(използвани от календара)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 border border-border rounded-md bg-background">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setYear(year - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2 text-sm font-semibold">{year}</span>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setYear(year + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="text-xs border-collapse" style={{ minWidth: 1800 }}>
          <thead className="sticky top-0 z-20 bg-navy text-white">
            <tr>
              <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider min-w-[200px] sticky left-0 z-30 bg-navy border-r border-navy-light">Служител</th>
              <th className="text-left px-2 py-2 font-semibold uppercase tracking-wider min-w-[140px] border-r border-navy-light">Длъжност</th>
              <th className="text-right px-2 py-2 font-semibold uppercase tracking-wider border-r border-navy-light" title="От минали години">Мин. г.</th>
              <th className="text-right px-2 py-2 font-semibold uppercase tracking-wider border-r border-navy-light" title="За текуща година">Тек. г.</th>
              <th className="text-right px-2 py-2 font-semibold uppercase tracking-wider border-r border-navy-light" title="Допълнителен платен годишен отпуск">Доп.</th>
              {MONTHS_SHORT.map((m, i) => (
                <th key={i} className="text-center px-1 py-2 font-semibold min-w-[32px]" title={`Използвани дни в ${m}`}>{m}</th>
              ))}
              <th className="text-right px-2 py-2 font-semibold uppercase tracking-wider border-l border-navy-light bg-emerald-700">Оставащи</th>
              <th className="text-right px-2 py-2 font-semibold uppercase tracking-wider min-w-[100px]" title="Дневна брутна ставка">Ставка</th>
              <th className="text-right px-2 py-2 font-semibold uppercase tracking-wider min-w-[80px]" title="Процент осигуровки">% осиг.</th>
              <th className="text-right px-2 py-2 font-semibold uppercase tracking-wider min-w-[100px]" title="Сума на оставащия отпуск (Оставащи × Ставка)">Сума</th>
              <th className="text-right px-2 py-2 font-semibold uppercase tracking-wider min-w-[100px]" title="Стойност на осигуровките (Сума × %)">Осиг.</th>
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 ? (
              <tr>
                <td colSpan={20} className="text-center py-12 text-muted-foreground">Няма активни служители.</td>
              </tr>
            ) : staff.map((s, i) => {
              const evenBg = i % 2 === 0 ? 'bg-card' : 'bg-muted/20'
              const q = quotaByStaff.get(s.id)
              const prev = Number(q?.prev_years_days) || 0
              const curr = q?.current_year_days != null ? Number(q.current_year_days) : 20
              const addl = Number(q?.additional_days) || 0
              const used = usedTotalByStaff.get(s.id) ?? 0
              const remaining = prev + curr + addl - used
              const rate = q?.daily_rate ?? null
              const pct = q?.insurance_pct ?? null
              const sum = rate != null ? +(remaining * Number(rate)).toFixed(2) : 0
              const ins = (rate != null && pct != null) ? +(sum * Number(pct)).toFixed(2) : 0
              const usedByMonth = usedByStaffMonth.get(s.id) ?? new Map()
              return (
                <tr key={s.id} className={`border-b border-border ${evenBg}`}>
                  <td className={`px-3 py-1 font-medium sticky left-0 z-10 ${evenBg} border-r border-border whitespace-nowrap`}>{s.full_name}</td>
                  <td className="px-2 py-1 text-muted-foreground border-r border-border whitespace-nowrap">{s.position ?? s.department ?? '—'}</td>
                  <td className="px-1 py-1 text-right border-r border-border">
                    <NumCell value={prev} onSave={v => saveQuota(s.id, { prev_years_days: v ?? 0 })} />
                  </td>
                  <td className="px-1 py-1 text-right border-r border-border">
                    <NumCell value={curr} onSave={v => saveQuota(s.id, { current_year_days: v ?? 0 })} />
                  </td>
                  <td className="px-1 py-1 text-right border-r border-border">
                    <NumCell value={addl} onSave={v => saveQuota(s.id, { additional_days: v ?? 0 })} />
                  </td>
                  {Array.from({ length: 12 }, (_, mi) => mi + 1).map(mo => {
                    const d = usedByMonth.get(mo) ?? 0
                    return (
                      <td key={mo} className="px-1 py-1 text-center text-[11px] tabular-nums">
                        {d > 0 ? d : <span className="text-muted-foreground/40">·</span>}
                      </td>
                    )
                  })}
                  <td className={`px-2 py-1 text-right border-l border-border tabular-nums font-semibold ${remaining < 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-400'}`}>
                    {remaining}
                  </td>
                  <td className="px-1 py-1 text-right">
                    <NumCell value={rate != null ? Number(rate) : null} step={0.01} placeholder="—" onSave={v => saveQuota(s.id, { daily_rate: v })} />
                  </td>
                  <td className="px-1 py-1 text-right">
                    <NumCell value={pct != null ? Number(pct) : null} step={0.0001} placeholder="0.1892" onSave={v => saveQuota(s.id, { insurance_pct: v })} />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{sum > 0 ? sum.toFixed(2) : '—'}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{ins > 0 ? ins.toFixed(2) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
