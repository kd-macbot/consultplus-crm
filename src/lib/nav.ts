import {
  LayoutDashboard, Users, UserCog, Wallet, CreditCard,
  ClipboardList, Settings, BookUser, Target, ClipboardCheck, CalendarRange, Receipt,
  ListChecks, IdCard, Banknote, CalendarDays, FileSpreadsheet, Inbox, Landmark,
  KanbanSquare, Coins, MessageSquare, Calculator, FileSignature, BellRing, KeyRound, Newspaper,
} from 'lucide-react'

// ============================================================
// Менюто на приложението — ЕДНО определение.
//
// Ползва се и от sidebar-а (Layout), и от бързото търсене (Ctrl+K). Ако
// правилата за достъп стоят преписани на двете места, търсенето рано или
// късно ще предложи страница, която колегата няма право да отвори — и то
// тихо, защото на екрана изглежда наред.
// ============================================================

export type BadgeKey = 'paymentsUnpaid' | 'absentToday' | 'absenceRequests' | 'recentNews' | 'myOpenTasks'

export type NavItem = {
  to: string
  label: string
  icon: typeof LayoutDashboard
  roles: string[]
  hideForTrz?: boolean
  badgeKeys?: BadgeKey[]
  showOnlyForTrzOrAdmin?: boolean
  showOnlyForBankDepts?: boolean
  showOnlyForAccounting?: boolean
  showOnlyForManagement?: boolean
}

export type NavSection = { title: string | null; items: NavItem[] }

export const NAV_SECTIONS: NavSection[] = [
  {
    title: null,  // Табло + Календар — без заглавие, най-отгоре в sidebar-а
    items: [
      { to: '/', label: 'Табло', icon: LayoutDashboard, roles: ['admin', 'manager', 'employee'] },
      { to: '/calendar', label: 'Календар', icon: CalendarDays, roles: ['admin', 'manager', 'employee'], badgeKeys: ['absentToday', 'recentNews'] },
      { to: '/tasks', label: 'Задачи', icon: KanbanSquare, roles: ['admin', 'manager', 'employee'], badgeKeys: ['myOpenTasks'] },
    ],
  },
  {
    title: 'Ежедневна работа',
    items: [
      { to: '/clients', label: 'Клиенти', icon: Users, roles: ['admin', 'manager', 'employee'] },
      { to: '/worksheet', label: 'Работен лист', icon: ClipboardCheck, roles: ['admin', 'manager', 'employee'] },
      { to: '/yearly', label: 'Годишен изглед', icon: CalendarRange, roles: ['admin', 'manager', 'employee'] },
      { to: '/trz', label: 'ТРЗ Работен лист', icon: Receipt, roles: ['admin', 'manager', 'employee'] },
      { to: '/cash-registers', label: 'Касови апарати', icon: Calculator, roles: ['admin', 'manager', 'employee'], showOnlyForAccounting: true },
      { to: '/checklist', label: 'Личен чек лист', icon: ListChecks, roles: ['admin', 'manager', 'employee'], hideForTrz: true },
      { to: '/cash-loans', label: 'Финансов мониторинг', icon: Coins, roles: ['admin', 'manager', 'employee'], hideForTrz: true },
      { to: '/contacts', label: 'Контакти', icon: BookUser, roles: ['admin', 'manager', 'employee'] },
      { to: '/profiles', label: 'Профили', icon: IdCard, roles: ['admin', 'manager', 'employee'] },
      { to: '/payments', label: 'Плащания', icon: Banknote, roles: ['admin', 'manager'], badgeKeys: ['paymentsUnpaid'] },
      { to: '/messages', label: 'Съобщения', icon: MessageSquare, roles: ['admin', 'manager', 'employee'] },
    ],
  },
  {
    title: 'Бизнес',
    items: [
      { to: '/contracts', label: 'Шаблони', icon: FileSignature, roles: ['admin', 'manager'], showOnlyForManagement: true },
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
      { to: '/absence-requests', label: 'Заявки за отпуска', icon: Inbox, roles: ['admin', 'manager'], badgeKeys: ['absenceRequests'], showOnlyForTrzOrAdmin: true },
      { to: '/vacations', label: 'Справка отпуска', icon: FileSpreadsheet, roles: ['admin', 'manager', 'employee'], showOnlyForTrzOrAdmin: true },
      { to: '/form76', label: 'Форма 76', icon: FileSpreadsheet, roles: ['admin', 'manager', 'employee'], showOnlyForTrzOrAdmin: true },
      { to: '/certificates', label: 'Електронни подписи', icon: KeyRound, roles: ['admin', 'manager'], showOnlyForManagement: true },
      { to: '/news-sources', label: 'Новини от бранша', icon: Newspaper, roles: ['admin', 'manager'], showOnlyForManagement: true },
      { to: '/notifications', label: 'Известия', icon: BellRing, roles: ['admin'] },
      { to: '/audit', label: 'Дневник', icon: ClipboardList, roles: ['admin'] },
      { to: '/admin', label: 'Настройки', icon: Settings, roles: ['admin'] },
    ],
  },
]

/** Кой какво вижда — ролята плюс отделите от crm_staff. */
export type NavAccess = {
  role: string | undefined
  isTrz: boolean
  canSeeBankAccess: boolean
  canSeeSpo: boolean
  canSeeTemplates: boolean
}

export function canSeeNavItem(item: NavItem, a: NavAccess): boolean {
  if (!a.role || !item.roles.includes(a.role)) return false
  if (item.hideForTrz && a.isTrz) return false
  if (item.showOnlyForTrzOrAdmin && a.role !== 'admin' && !a.isTrz) return false
  if (item.showOnlyForBankDepts && !a.canSeeBankAccess) return false
  if (item.showOnlyForAccounting && !a.canSeeSpo) return false
  if (item.showOnlyForManagement && !a.canSeeTemplates) return false
  return true
}

/** Плосък списък от видимите страници — за търсенето. */
export function visibleNavItems(a: NavAccess): NavItem[] {
  return NAV_SECTIONS.flatMap(s => s.items).filter(i => canSeeNavItem(i, a))
}
