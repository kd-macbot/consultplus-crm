import { useState, useMemo } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useStaff, usePaymentConfigs, usePaymentStatuses, useAbsences, useNews } from '../../lib/queries'
import { previousMonth, namesMatch } from '../../lib/utils'
import {
  LayoutDashboard, Users, UserCog, Wallet, CreditCard,
  ClipboardList, Settings, LogOut, Menu, X, ChevronRight, BookUser, Target, ClipboardCheck, CalendarRange, Receipt, ListChecks, IdCard, Banknote, CalendarDays, FileSpreadsheet, Inbox, Landmark,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { EnvironmentBanner } from './EnvironmentBanner'

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; roles: string[]; hideForTrz?: boolean; badgeKey?: 'paymentsUnpaid' | 'absentToday' | 'absenceRequests' | 'recentNews'; showOnlyForTrzOrAdmin?: boolean; showOnlyForBankDepts?: boolean }
type NavSection = { title: string | null; items: NavItem[] }

const NAV_SECTIONS: NavSection[] = [
  {
    title: null,  // Табло + Календар — без заглавие, най-отгоре в sidebar-а
    items: [
      { to: '/', label: 'Табло', icon: LayoutDashboard, roles: ['admin', 'manager', 'employee'] },
      { to: '/calendar', label: 'Календар', icon: CalendarDays, roles: ['admin', 'manager', 'employee'], badgeKey: 'recentNews' },
    ],
  },
  {
    title: 'Ежедневна работа',
    items: [
      { to: '/clients', label: 'Клиенти', icon: Users, roles: ['admin', 'manager', 'employee'] },
      { to: '/worksheet', label: 'Работен лист', icon: ClipboardCheck, roles: ['admin', 'manager', 'employee'] },
      { to: '/yearly', label: 'Годишен изглед', icon: CalendarRange, roles: ['admin', 'manager', 'employee'] },
      { to: '/trz', label: 'ТРЗ Работен лист', icon: Receipt, roles: ['admin', 'manager', 'employee'] },
      { to: '/checklist', label: 'Личен чек лист', icon: ListChecks, roles: ['admin', 'manager', 'employee'], hideForTrz: true },
      { to: '/contacts', label: 'Контакти', icon: BookUser, roles: ['admin', 'manager', 'employee'] },
      { to: '/profiles', label: 'Профили', icon: IdCard, roles: ['admin', 'manager', 'employee'] },
      { to: '/payments', label: 'Плащания', icon: Banknote, roles: ['admin', 'manager'], badgeKey: 'paymentsUnpaid' },
    ],
  },
  {
    title: 'Бизнес',
    items: [
      { to: '/opportunities', label: 'Възможности', icon: Target, roles: ['admin'] },
      { to: '/subscriptions', label: 'Абонаменти', icon: CreditCard, roles: ['admin'] },
      { to: '/expenses', label: 'Разходи', icon: Wallet, roles: ['admin'] },
    ],
  },
  {
    title: 'Администрация',
    items: [
      { to: '/staff', label: 'Персонал', icon: UserCog, roles: ['admin'] },
      { to: '/bank-access', label: 'Банков достъп', icon: Landmark, roles: ['admin', 'manager', 'employee'], showOnlyForBankDepts: true },
      { to: '/absence-requests', label: 'Заявки за отпуска', icon: Inbox, roles: ['admin', 'manager'], badgeKey: 'absenceRequests', showOnlyForTrzOrAdmin: true },
      { to: '/vacations', label: 'Справка отпуска', icon: FileSpreadsheet, roles: ['admin', 'manager', 'employee'], showOnlyForTrzOrAdmin: true },
      { to: '/form76', label: 'Форма 76', icon: FileSpreadsheet, roles: ['admin', 'manager', 'employee'], showOnlyForTrzOrAdmin: true },
      { to: '/audit', label: 'Дневник', icon: ClipboardList, roles: ['admin'] },
      { to: '/admin', label: 'Настройки', icon: Settings, roles: ['admin'] },
    ],
  },
]

const roleLabel: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Мениджър',
  employee: 'Служител',
}

export function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Дали потребителят е от ТРЗ отдела — за скриване на „Личен чек лист".
  // staffList идва от споделения RQ кеш (без излишен fetch).
  const staffQ = useStaff()
  const myStaff = useMemo(
    () => (staffQ.data ?? []).find(s => namesMatch(s.full_name, user?.full_name)),
    [staffQ.data, user?.full_name],
  )
  const inDept = (dept: string) =>
    myStaff?.department === dept || (myStaff?.additional_departments ?? []).includes(dept)
  const isTrz = inDept('ТРЗ')
  // Банков достъп се вижда от Тийм Лийд / Управление (+ admin).
  const canSeeBankAccess = user?.role === 'admin' || inDept('Тийм Лийд') || inDept('Управление')

  // ============================================================
  // Бадж за „Плащания" — брой неплатени за РАБОТНИЯ месец (предходния).
  // В счетоводството „работен месец" = предходният календарен месец
  // (напр. в март обработваме февруарските срокове). Това е същата
  // конвенция като в Личен чек лист и работен лист за ДДС.
  //
  // Зареждаме само за admin/manager (те виждат страницата). RQ кешира.
  // ============================================================
  const showPaymentsBadge = user?.role === 'admin' || user?.role === 'manager'
  const now = useMemo(() => new Date(), [])
  const work = useMemo(() => previousMonth(), [])
  const paymentConfigsQ = usePaymentConfigs()
  const paymentStatusesQ = usePaymentStatuses(showPaymentsBadge ? work.year : 0)
  const paymentsUnpaid = useMemo(() => {
    if (!showPaymentsBadge) return 0
    const configs = paymentConfigsQ.data ?? []
    const statuses = paymentStatusesQ.data ?? []
    const paidIdx = new Set<string>()
    statuses.forEach(s => {
      if (s.month === work.month && s.paid) paidIdx.add(`${s.client_id}|${s.payment_type}`)
    })
    let unpaid = 0
    configs.forEach(c => {
      c.payment_types.forEach(t => {
        if (!paidIdx.has(`${c.client_id}|${t}`)) unpaid++
      })
    })
    return unpaid
  }, [showPaymentsBadge, paymentConfigsQ.data, paymentStatusesQ.data, work.month])

  // ============================================================
  // Бадж за „Календар" — брой служители, отсъстващи ДНЕС.
  // Зарежда абсенсиите за текущата година (RQ кешира).
  // ============================================================
  const todayYear = now.getFullYear()
  const todayIso = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])
  const absencesQ = useAbsences(todayYear)
  const absentToday = useMemo(() => {
    // Само одобрените се броят за „днес отсъстващи".
    const todays = (absencesQ.data ?? []).filter(a =>
      a.status === 'approved' && a.start_date <= todayIso && a.end_date >= todayIso,
    )
    // Уникални staff_id-та (същ. служител може да има два припокриващи се записа).
    return new Set(todays.map(a => a.staff_id)).size
  }, [absencesQ.data, todayIso])

  // Заявки за одобрение — бадж за admin или manager-ТРЗ (виждат страницата).
  const absenceRequests = useMemo(() => {
    const isAdmin = user?.role === 'admin'
    const isManagerTrz = user?.role === 'manager' && isTrz
    if (!isAdmin && !isManagerTrz) return 0
    return (absencesQ.data ?? []).filter(a => a.status === 'pending').length
  }, [absencesQ.data, user?.role, isTrz])

  // Нови новини (последните 24 часа) — бадж на Календар.
  const newsQ = useNews()
  const recentNews = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60_000
    return (newsQ.data ?? []).filter(n => new Date(n.created_at).getTime() >= cutoff).length
  }, [newsQ.data])

  const badges: Record<string, number> = { paymentsUnpaid: paymentsUnpaid, absentToday, absenceRequests, recentNews }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const initials = user?.full_name
    ?.split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() ?? '?'

  return (
    <div className="min-h-screen flex flex-col bg-background">

      {/* Видим маркер за dev/test среда — не се рендерира на production.
          Стои като header горе на цялата ширина. */}
      <EnvironmentBanner />

      <div className="flex-1 flex min-h-0">

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-navy text-white flex items-center px-4 z-40 shadow-lg">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="text-white hover:bg-white/10 hover:text-white mr-3 h-8 w-8"
        >
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
        <span className="font-bold tracking-tight">Consult Plus</span>
        <span className="ml-1 text-white/40 text-sm font-light">CRM</span>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 top-14 bg-black/40 z-20 md:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        'w-64 bg-navy text-white flex flex-col shrink-0',
        'fixed top-14 bottom-0 left-0 z-30',
        'md:relative md:top-0 md:bottom-auto md:translate-x-0 md:h-screen md:sticky',
        'transform transition-transform duration-200 ease-in-out',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      )}>
        {/* Logo — desktop only */}
        <div className="hidden md:flex items-center gap-2.5 px-5 py-5 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
            <span className="text-sm font-bold">C+</span>
          </div>
          <div>
            <p className="font-bold text-sm leading-tight">Consult Plus</p>
            <p className="text-[10px] text-white/40 leading-tight">CRM платформа</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV_SECTIONS.map((section, secIdx) => {
            const visibleItems = section.items.filter(item =>
              user && item.roles.includes(user.role)
                && !(item.hideForTrz && isTrz)
                && !(item.showOnlyForTrzOrAdmin && user.role !== 'admin' && !isTrz)
                && !(item.showOnlyForBankDepts && !canSeeBankAccess)
            )
            if (visibleItems.length === 0) return null
            return (
              <div key={section.title ?? `s${secIdx}`} className={secIdx > 0 ? 'mt-2' : ''}>
                {section.title && (
                  <p className="px-3 pt-1 pb-0.5 text-[10px] font-semibold text-white/30 uppercase tracking-widest">
                    {section.title}
                  </p>
                )}
                {visibleItems.map(item => {
                  const Icon = item.icon
                  const badgeCount = item.badgeKey ? badges[item.badgeKey] : 0
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) => cn(
                        'flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-all duration-150 group',
                        isActive
                          ? 'bg-white/15 text-white font-medium'
                          : 'text-white/60 hover:bg-white/8 hover:text-white'
                      )}
                    >
                      {({ isActive }) => (
                        <>
                          <Icon className={cn('h-4 w-4 shrink-0 transition-colors', isActive ? 'text-white' : 'text-white/50 group-hover:text-white/80')} />
                          <span className="flex-1">{item.label}</span>
                          {badgeCount > 0 && (
                            <span
                              title={
                                item.badgeKey === 'absentToday'
                                  ? `${badgeCount} ${badgeCount === 1 ? 'отсъстващ' : 'отсъстващи'} днес`
                                  : item.badgeKey === 'absenceRequests'
                                    ? `${badgeCount} ${badgeCount === 1 ? 'заявка' : 'заявки'} чакат одобрение`
                                    : item.badgeKey === 'recentNews'
                                      ? `${badgeCount} ${badgeCount === 1 ? 'нова новина' : 'нови новини'} в последните 24 ч.`
                                      : `${badgeCount} неплатени за работния месец`
                              }
                              className={cn(
                                'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold text-white shrink-0',
                                item.badgeKey === 'absentToday' ? 'bg-sky-500'
                                  : item.badgeKey === 'absenceRequests' ? 'bg-rose-500'
                                  : item.badgeKey === 'recentNews' ? 'bg-emerald-500'
                                  : 'bg-amber-500',
                              )}
                            >
                              {badgeCount > 99 ? '99+' : badgeCount}
                            </span>
                          )}
                          {isActive && <ChevronRight className="h-3 w-3 text-white/40" />}
                        </>
                      )}
                    </NavLink>
                  )
                })}
              </div>
            )
          })}
        </nav>

        <Separator className="bg-white/10" />

        {/* User info + logout */}
        <div className="px-3 py-4">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate leading-tight">{user?.full_name}</p>
              <p className="text-[11px] text-white/40 leading-tight">{user ? roleLabel[user.role] : ''}</p>
            </div>
          </div>
          <ThemeToggle />
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-white/40 hover:text-white hover:bg-white/8 transition-all mt-1"
          >
            <LogOut className="h-3.5 w-3.5" />
            Изход
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto pt-14 md:pt-0 min-w-0">
        <Outlet />
      </main>
      </div>
    </div>
  )
}
