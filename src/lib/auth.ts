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
  // Викаме Edge Function-а вместо локален auth.signUp() — той използва
  // admin API (service role), маркира имейла като confirmed и не праща
  // никакъв имейл. Така заобикаляме email rate limit-а на Supabase free tier.
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return { error: 'Не сте логнат' }

  try {
    const { data, error } = await supabase.functions.invoke('admin-create-user', {
      body: { email, password, full_name, role },
    })
    if (error) return { error: error.message }
    if (data?.error) return { error: data.error }
    if (!data?.userId) return { error: 'Неочакван отговор от сървъра' }
    return { userId: data.userId }
  } catch (err) {
    return { error: (err as Error).message ?? 'Грешка при създаване на потребител' }
  }
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
