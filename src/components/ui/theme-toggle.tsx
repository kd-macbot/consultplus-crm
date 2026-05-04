import { useState, useEffect } from 'react'
import { Sun, Moon } from 'lucide-react'

function getInitialDark(): boolean {
  if (typeof window === 'undefined') return false
  const stored = localStorage.getItem('crm-theme')
  if (stored) return stored === 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function ThemeToggle() {
  const [dark, setDark] = useState(getInitialDark)

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('crm-theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('crm-theme', 'light')
    }
  }, [dark])

  return (
    <button
      onClick={() => setDark(d => !d)}
      title={dark ? 'Светла тема' : 'Тъмна тема'}
      className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-white/40 hover:text-white hover:bg-white/8 transition-all"
    >
      {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
      {dark ? 'Светла тема' : 'Тъмна тема'}
    </button>
  )
}
