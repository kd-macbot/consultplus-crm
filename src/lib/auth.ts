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
  console.log('[Auth] signIn attempt:', email)
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    console.error('[Auth] signIn error:', error.message)
    return { error: error.message }
  }
  console.log('[Auth] signIn OK, user:', data.user.id)
  
  // Fetch profile
  console.log('[Auth] Fetching profile...')
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single()
  
  console.log('[Auth] Profile result:', profile, profileError)
  if (profileError) return { error: 'Профилът не е намерен' }
  return { profile: profile as Profile }
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function getCurrentProfile(): Promise<Profile | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return null
    const user = session.user

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    if (error || !data) return null
    return data as Profile
  } catch (err) {
    console.warn('[Auth] getCurrentProfile failed:', err)
    return null
  }
}

export const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  login: async () => ({}),
  logout: async () => {},
  isRole: () => false,
})

export const useAuth = () => useContext(AuthContext)
