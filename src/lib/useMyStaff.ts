import { useCallback, useMemo } from 'react'
import { useAuth } from './auth'
import { useStaff } from './queries'
import { namesMatch } from './utils'

// ============================================================
// useMyStaff — ЕДИНСТВЕНИЯТ lookup „текущ потребител → staff запис".
//
// Преди беше копиран в 7 файла (Layout, Calendar, Checklist, Vacations,
// Form76, AbsenceRequests, BankAccess) — точно от такова разминаване
// дойде бъгът „профилът ти не е свързан" (exact match вместо
// нормализирано сравнение). Сега промяна в match логиката се прави
// само тук.
//
// Съпоставянето е по име (namesMatch: trim + collapse spaces +
// lowercase) срещу активните служители от useStaff() (споделен RQ кеш —
// без допълнителен fetch).
// ============================================================
export function useMyStaff() {
  const { user } = useAuth()
  const staffQ = useStaff()

  const myStaff = useMemo(
    () => (staffQ.data ?? []).find(s => namesMatch(s.full_name, user?.full_name)),
    [staffQ.data, user?.full_name],
  )

  /** В отдел ли е потребителят — проверява основния И допълнителните. */
  const inDept = useCallback(
    (dept: string) =>
      myStaff?.department === dept || (myStaff?.additional_departments ?? []).includes(dept),
    [myStaff],
  )

  return { myStaff, inDept, isAdmin: user?.role === 'admin', user, staffQ }
}
