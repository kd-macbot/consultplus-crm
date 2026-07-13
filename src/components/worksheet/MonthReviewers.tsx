import { useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { Lock, UserCheck } from 'lucide-react'
import { useStaff, useMonthReviewers, useInvalidateCrm } from '../../lib/queries'
import { seedMonthReviewers, setMonthReviewers } from '../../lib/storage'
import { useMyStaff } from '../../lib/useMyStaff'
import { useAuth } from '../../lib/auth'
import { formatDate } from '../../lib/utils'
import { useRealtime } from '../../lib/useRealtime'

// ============================================================
// Проверяващи на месеца — двама души от отдел Счетоводство, които
// правят финалната проверка („Проверено") преди закриване на месеца.
//
// - Авто-назначаване: при първо отваряне на месец без проверяващи,
//   системата тегли 2 различни на случаен принцип (ignoreDuplicates
//   при race между колеги).
// - Сменяеми до 14-то число ВКЛ. на месеца след работния (ДДС срока).
// - След това: само admin, с допълнително confirm.
// ============================================================

function deadlineFor(year: number, month: number): Date {
  // 14-ти на месеца СЛЕД работния, край на деня.
  // month е 1-базиран → new Date(year, month, 14) е следващият месец.
  return new Date(year, month, 14, 23, 59, 59, 999)
}

export function MonthReviewersWidget({ year, month }: { year: number; month: number }) {
  const { user } = useAuth()
  const { isAdmin } = useMyStaff()
  const staffQ = useStaff()
  const reviewersQ = useMonthReviewers(year, month)
  const { invalidateMonthReviewers } = useInvalidateCrm()

  // Пул: отдел Счетоводство (основен или допълнителен), активни.
  const pool = useMemo(
    () => (staffQ.data ?? []).filter(s =>
      s.department === 'Счетоводство' || (s.additional_departments ?? []).includes('Счетоводство'),
    ),
    [staffQ.data],
  )

  // Live sync — колега сменя/seed-ва → всички виждат веднага.
  useRealtime({
    channel: 'month-reviewers',
    tables: ['crm_month_reviewers'],
    onChange: () => invalidateMonthReviewers(year, month),
  })

  const deadline = useMemo(() => deadlineFor(year, month), [year, month])
  const locked = Date.now() > deadline.getTime()
  const canEdit = !locked || isAdmin

  const reviewers = reviewersQ.data
  const r1 = reviewers?.reviewer1_staff_id ?? ''
  const r2 = reviewers?.reviewer2_staff_id ?? ''

  // Авто-назначаване — само за все още отключени месеци, веднъж на mount.
  const seededRef = useRef<string | null>(null)
  useEffect(() => {
    const key = `${year}-${month}`
    if (seededRef.current === key) return
    if (reviewersQ.data !== null || !reviewersQ.isFetched) return  // има запис или още зарежда
    if (locked || pool.length < 2) return
    seededRef.current = key
    // Random два различни от пула.
    const shuffled = [...pool].sort(() => Math.random() - 0.5)
    void seedMonthReviewers(year, month, shuffled[0].id, shuffled[1].id, user?.id)
      .then(() => invalidateMonthReviewers(year, month))
      .catch(() => { /* друг колега може вече да е seed-нал — ще дойде по realtime/refetch */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, reviewersQ.data, reviewersQ.isFetched, locked, pool.length])

  async function change(which: 1 | 2, staffId: string) {
    const next1 = which === 1 ? staffId : r1
    const next2 = which === 2 ? staffId : r2
    if (next1 && next1 === next2) {
      toast.error('Двамата проверяващи трябва да са различни.')
      return
    }
    if (locked) {
      // Само admin стига дотук (за останалите select-ът е disabled).
      const ok = confirm(
        `Срокът за смяна (14-ти) е минал!\n\nСигурен ли си, че искаш да смениш проверяващ за ${month}.${year} със задна дата?`,
      )
      if (!ok) return
    }
    try {
      await setMonthReviewers(year, month, next1 || null, next2 || null, user?.id)
      await invalidateMonthReviewers(year, month)
      toast.success('Проверяващите са обновени')
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
    }
  }

  if (!staffQ.data) return null

  const selectClass =
    'h-7 px-1.5 text-xs border rounded bg-background focus:border-primary focus:outline-none ' +
    'border-amber-300 dark:border-amber-700 disabled:opacity-60 disabled:cursor-not-allowed'

  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700"
      title={locked
        ? `Заключено — срокът за смяна беше до ${formatDate(deadline.toISOString().slice(0, 10))} вкл.${isAdmin ? ' Като admin можеш да коригираш с потвърждение.' : ''}`
        : `Проверяващите могат да се сменят до ${formatDate(deadline.toISOString().slice(0, 10))} вкл.`}
    >
      <UserCheck className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400 shrink-0" />
      <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide hidden lg:inline">
        Проверяващи:
      </span>
      <select
        value={r1}
        disabled={!canEdit}
        onChange={e => void change(1, e.target.value)}
        className={selectClass}
      >
        <option value="">—</option>
        {pool.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
      </select>
      <select
        value={r2}
        disabled={!canEdit}
        onChange={e => void change(2, e.target.value)}
        className={selectClass}
      >
        <option value="">—</option>
        {pool.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
      </select>
      {locked && <Lock className="h-3 w-3 text-amber-700 dark:text-amber-400 shrink-0" />}
    </div>
  )
}
