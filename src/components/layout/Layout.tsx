import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'

const NAV_ITEMS = [
  { to: '/', label: '📊 Табло', roles: ['admin', 'manager', 'employee'] },
  { to: '/clients', label: '👥 Клиенти', roles: ['admin', 'manager', 'employee'] },
  { to: '/staff', label: '👤 Персонал', roles: ['admin', 'manager'] },
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
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Mobile toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-3 left-3 z-50 md:hidden bg-navy text-white p-2 rounded-lg shadow-lg"
      >
        {sidebarOpen ? '✕' : '☰'}
      </button>

      {/* Sidebar */}
      <aside className={`w-60 bg-navy text-white flex flex-col shrink-0 fixed md:static inset-y-0 left-0 z-40 transform transition-transform duration-200 ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }`}>
        <div className="p-4 border-b border-white/10">
          <h1 className="text-lg font-bold">Consult Plus</h1>
          <p className="text-xs text-white/50">CRM</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.filter(item => user && item.roles.includes(user.role)).map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `block px-3 py-2 rounded text-sm transition ${
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

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
