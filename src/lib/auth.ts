import { createContext, useContext } from 'react'
import { createClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile, Role } from './types'

// Isolated client for admin user creation — persistSession: false ensures the
// admin's own session is never replaced when signing up a new account.
const _tempClient = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
)

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

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single()
  if (profileError) return { error: 'Профилът не е намерен' }
  const p = profile as Profile
  if (p.is_active === false) {
    await supabase.auth.signOut()
    return { error: 'Акаунтът е деактивиран. Свържете се с администратор.' }
  }
  return { profile: p }
}

export async function adminCreateUser(
  email: string,
  password: string,
  full_name: string,
  role: Role
): Promise<{ error?: string; userId?: string }> {
  const { data, error } = await _tempClient.auth.signUp({ email, password })
  if (error) return { error: error.message }

  const userId = data.user?.id
  if (!userId) return { error: 'Не може да се създаде акаунт. Проверете дали имейлът вече съществува.' }

  // Insert (or overwrite trigger-created) profile with the correct name and role
  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({ id: userId, email, full_name, role, is_active: true })
  if (profileError) return { error: profileError.message }

  return { userId }
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function getCurrentProfile(): Promise<Profile | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return null

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
    if (error || !data) return null
    return data as Profile
  } catch {
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
