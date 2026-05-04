import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import {
  LayoutDashboard, Users, UserCog, Wallet, CreditCard,
  ClipboardList, Settings, LogOut, Menu, X, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ThemeToggle } from '@/components/ui/theme-toggle'

const NAV_ITEMS = [
  { to: '/', label: 'Табло', icon: LayoutDashboard, roles: ['admin', 'manager', 'employee'] },
  { to: '/clients', label: 'Клиенти', icon: Users, roles: ['admin', 'manager', 'employee'] },
  { to: '/staff', label: 'Персонал', icon: UserCog, roles: ['admin', 'manager'] },
  { to: '/expenses', label: 'Разходи', icon: Wallet, roles: ['admin', 'manager'] },
  { to: '/subscriptions', label: 'Абонаменти', icon: CreditCard, roles: ['admin', 'manager'] },
  { to: '/audit', label: 'Дневник', icon: ClipboardList, roles: ['admin', 'manager'] },
  { to: '/admin', label: 'Настройки', icon: Settings, roles: ['admin'] },
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
    <div className="min-h-screen flex bg-background">

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
          <p className="px-3 py-1 text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1">
            Меню
          </p>
          {NAV_ITEMS.filter(item => user && item.roles.includes(user.role)).map(item => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) => cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 group',
                  isActive
                    ? 'bg-white/15 text-white font-medium'
                    : 'text-white/60 hover:bg-white/8 hover:text-white'
                )}
              >
                {({ isActive }) => (
                  <>
                    <Icon className={cn('h-4 w-4 shrink-0 transition-colors', isActive ? 'text-white' : 'text-white/50 group-hover:text-white/80')} />
                    <span className="flex-1">{item.label}</span>
                    {isActive && <ChevronRight className="h-3 w-3 text-white/40" />}
                  </>
                )}
              </NavLink>
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
  )
}
