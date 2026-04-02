import { createContext, useContext } from 'react'
import { supabase } from './supabase'
import type { Profile, Role } from './types'

export interface AuthState {
  user: Profile | null
  loading: boolean
  login: (email: string, password: string) => Promise<{ error?: string }>
  logout: () => Promise<void>
  isRole: (role: Role) => boolean
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: error.message }
  
  // Fetch profile
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single()
  
  if (profileError) return { error: 'Профилът не е намерен' }
  return { profile: profile as Profile }
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
  
  if (error || !data) return null
  return data as Profile
}

export const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  login: async () => ({}),
  logout: async () => {},
  isRole: () => false,
})

export const useAuth = () => useContext(AuthContext)
