import { createContext, useContext } from 'react'
import type { Profile, Role } from './types'

export interface AuthState {
  user: Profile | null
  login: (email: string, password: string) => boolean
  logout: () => void
  isRole: (role: Role) => boolean
}

const MOCK_USERS: Array<Profile & { password: string }> = [
  { id: '1', email: 'admin@consultplus.bg', password: 'admin123', full_name: 'Администратор', role: 'admin', created_at: new Date().toISOString() },
  { id: '2', email: 'manager@consultplus.bg', password: 'manager123', full_name: 'Мениджър', role: 'manager', created_at: new Date().toISOString() },
  { id: '3', email: 'employee@consultplus.bg', password: 'employee123', full_name: 'Служител', role: 'employee', created_at: new Date().toISOString() },
]

export function authenticate(email: string, password: string): Profile | null {
  const found = MOCK_USERS.find(u => u.email === email && u.password === password)
  if (!found) return null
  const { password: _, ...profile } = found
  return profile
}

export const AuthContext = createContext<AuthState>({
  user: null,
  login: () => false,
  logout: () => {},
  isRole: () => false,
})

export const useAuth = () => useContext(AuthContext)
