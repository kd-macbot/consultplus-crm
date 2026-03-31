import { useState, useEffect, type ReactNode } from 'react'
import { AuthContext, authenticate } from '../../lib/auth'
import type { Profile, Role } from '../../lib/types'

const STORAGE_KEY = 'cp_auth_user'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  })

  useEffect(() => {
    if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
    else localStorage.removeItem(STORAGE_KEY)
  }, [user])

  const login = (email: string, password: string): boolean => {
    const profile = authenticate(email, password)
    if (profile) { setUser(profile); return true }
    return false
  }

  const logout = () => setUser(null)
  const isRole = (role: Role) => user?.role === role

  return (
    <AuthContext.Provider value={{ user, login, logout, isRole }}>
      {children}
    </AuthContext.Provider>
  )
}
