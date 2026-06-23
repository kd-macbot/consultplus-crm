import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Inbox, Check, X, Clock } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuth } from '../lib/auth'
import { useStaff, useAbsences, useInvalidateCrm } from '../lib/queries'
import { approveAbsence, rejectAbsence } from '../lib/storage'
import { ABSENCE_TYPE_LABELS, ABSENCE_TYPE_COLORS, type AbsenceType } from '../lib/types'
import { namesMatch } from '../lib/utils'

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('bg-BG')
}

function workingDaysBetween(start: string, end: string): number {
  const a = new Date(start + 'T00:00:00')
  const b = new Date(end + 'T00:00:00')
  if (a > b) return 0
  let count = 0
  const cur = new Date(a)
  while (cur <= b) {
    const dow = cur.getDay()
    if (dow !== 0 && dow !== 6) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

export function AbsenceRequestsPage() {
  const { user } = useAuth()
  const [year] = useState(new Date().getFullYear())
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')

  const staffQ = useStaff()
  const absencesQ = useAbsences(year)
  const { invalidateAbsences } = useInvalidateCrm()

  const staffById = useMemo(() => {
    const m = new Map<string, { name: string; dept: string | null }>()
    ;(staffQ.data ?? []).forEach(s => m.set(s.id, { name: s.full_name, dept: s.department }))
    return m
  }, [staffQ.data])

  const requests = useMemo(() => {
    const all = absencesQ.data ?? []
    const list = filter === 'pending' ? all.filter(a => a.status === 'pending') : all
    return [...list].sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [absencesQ.data, filter])

  const pendingCount = useMemo(
    () => (absencesQ.data ?? []).filter(a => a.status === 'pending').length,
    [absencesQ.data],
  )

  // Достъп — admin или manager-ТРЗ. Само admin може да одобрява/отказва;
  // manager-ТРЗ е в read-only режим (вижда списъка, но без бутони).
  const myStaff = useMemo(
    () => (staffQ.data ?? []).find(s => namesMatch(s.full_name, user?.full_name)),
    [staffQ.data, user?.full_name],
  )
  const isAdmin = user?.role === 'admin'
  const isManagerTrz = user?.role === 'manager' && myStaff?.department === 'ТРЗ'
  const canSee = isAdmin || isManagerTrz
  const canApprove = isAdmin

  if (!canSee) {
    return <Navigate to="/" replace />
  }

  const ready = !!staffQ.data && !!absencesQ.data
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

  const handleApprove = async (id: string) => {
    if (!user?.id) return
    try {
      await approveAbsence(id, user.id)
      await invalidateAbsences(year)
      toast.success('Заявката е одобрена')
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка')
    }
  }

  const handleReject = async (id: string) => {
    if (!user?.id) return
    const reason = prompt('Причина за отказ (незадължително):') ?? ''
    try {
      await rejectAbsence(id, user.id, reason || null)
      await invalidateAbsences(year)
      toast.success('Заявката е отказана')
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка')
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] md:h-screen">
      <div className="px-3 py-2 md:px-5 md:py-3 border-b border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <Inbox className="h-5 w-5 text-muted-foreground" />
            <div>
              <h1 className="text-base md:text-lg font-semibold text-foreground">Заявки за отсъствие</h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {pendingCount > 0 ? `${pendingCount} чакащи за одобрение` : 'Няма чакащи заявки'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 border border-border rounded-md bg-background p-0.5">
            <Button
              variant={filter === 'pending' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setFilter('pending')}
              className="h-7 px-3 text-xs"
            >
              Чакащи ({pendingCount})
            </Button>
            <Button
              variant={filter === 'all' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setFilter('all')}
              className="h-7 px-3 text-xs"
            >
              Всички
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 md:p-5">
        {requests.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Inbox className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p>{filter === 'pending' ? 'Няма чакащи заявки.' : 'Няма заявки.'}</p>
          </div>
        ) : (
          <div className="space-y-2 max-w-3xl">
            {requests.map(r => {
              const s = staffById.get(r.staff_id)
              const days = workingDaysBetween(r.start_date, r.end_date)
              const typeColor = ABSENCE_TYPE_COLORS[r.type as AbsenceType] ?? 'bg-gray-400 text-white'
              const statusColor =
                r.status === 'approved' ? 'text-emerald-700 dark:text-emerald-400'
                : r.status === 'rejected' ? 'text-red-700 dark:text-red-400'
                : 'text-amber-700 dark:text-amber-400'
              const statusLabel =
                r.status === 'approved' ? '✓ Одобрена'
                : r.status === 'rejected' ? '✗ Отказана'
                : '⏳ Чака'
              return (
                <div key={r.id} className="bg-card border border-border rounded-lg p-3 flex flex-wrap items-center gap-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${typeColor}`}>
                    {ABSENCE_TYPE_LABELS[r.type as AbsenceType] ?? r.type}
                  </span>
                  <div className="flex-1 min-w-[200px]">
                    <div className="font-medium text-sm text-foreground">{s?.name ?? 'Неизвестен'}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(r.start_date)} → {formatDate(r.end_date)} ({days} раб. дни)
                      {s?.dept && <span className="ml-2 text-[11px]">· {s.dept}</span>}
                    </div>
                    {r.notes && (
                      <div className="text-xs text-muted-foreground mt-0.5 italic">„{r.notes}"</div>
                    )}
                    {r.status === 'rejected' && r.rejection_reason && (
                      <div className="text-xs text-red-600 mt-0.5">Причина: {r.rejection_reason}</div>
                    )}
                  </div>
                  <div className={`text-xs font-medium ${statusColor}`}>{statusLabel}</div>
                  {r.status === 'pending' && canApprove ? (
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => handleReject(r.id)}>
                        <X className="h-3.5 w-3.5" /> Откажи
                      </Button>
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => handleApprove(r.id)}>
                        <Check className="h-3.5 w-3.5" /> Одобри
                      </Button>
                    </div>
                  ) : r.approved_at && (
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(r.approved_at).toLocaleDateString('bg-BG')}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
