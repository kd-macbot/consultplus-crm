import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'

const NAV_ITEMS = [
  { to: '/', label: '📊 Табло', roles: ['admin', 'manager', 'employee'] },
  { to: '/clients', label: '👥 Клиенти', roles: ['admin', 'manager', 'employee'] },
  { to: '/staff', label: '👤 Персонал', roles: ['admin', 'manager'] },
  { to: '/expenses', label: '💰 Разходи', roles: ['admin', 'manager'] },
  { to: '/subscriptions', label: '💶 Абонаменти', roles: ['admin', 'manager'] },
  { to: '/audit', label: '📝 Промени', roles: ['admin', 'manager'] },
  { to: '/admin', label: '⚙️ Админ', roles: ['admin'] },
]

export function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const roleLabel = { admin: 'Администратор', manager: 'Мениджър', employee: 'Служител' }

  return (
    <div className="min-h-screen flex bg-light">

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-12 bg-navy text-white flex items-center px-3 z-40 shadow">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="mr-3 text-lg w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 transition"
          aria-label="Меню"
        >
          {sidebarOpen ? '✕' : '☰'}
        </button>
        <span className="font-bold text-sm">Consult Plus</span>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 top-12 bg-black/50 z-20 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        w-64 bg-navy text-white flex flex-col shrink-0
        fixed top-12 bottom-0 left-0 z-30
        md:relative md:top-0 md:bottom-auto md:translate-x-0 md:h-screen md:sticky
        transform transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="hidden md:block p-4 border-b border-white/10">
          <h1 className="text-lg font-bold">Consult Plus</h1>
          <p className="text-xs text-white/50">CRM</p>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.filter(item => user && item.roles.includes(user.role)).map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `block px-3 py-2.5 rounded text-sm transition ${
                  isActive ? 'bg-white/20 font-medium' : 'hover:bg-white/10'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-white/10">
          <p className="text-sm font-medium truncate">{user?.full_name}</p>
          <p className="text-xs text-white/50">{user ? roleLabel[user.role] : ''}</p>
          <button
            onClick={handleLogout}
            className="mt-2 text-xs text-white/60 hover:text-white transition"
          >
            Изход →
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto pt-12 md:pt-0 min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
