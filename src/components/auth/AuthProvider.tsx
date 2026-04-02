import { useState, useEffect, type ReactNode } from 'react'
import { AuthContext, signIn, signOut, getCurrentProfile } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import type { Profile, Role } from '../../lib/types'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    console.log('[Auth] Initializing...')
    // Check initial session
    getCurrentProfile().then(profile => {
      console.log('[Auth] Profile loaded:', profile?.email || 'none')
      setUser(profile)
      setLoading(false)
      initialized = true
    }).catch(err => {
      console.error('[Auth] Init error:', err)
      setUser(null)
      setLoading(false)
      initialized = true
    })

    // Listen for auth changes (skip during initial load)
    let initialized = false
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event) => {
      console.log('[Auth] State change:', event, 'initialized:', initialized)
      if (!initialized) return // skip — initial load handles it
      if (event === 'SIGNED_IN') {
        const profile = await getCurrentProfile()
        setUser(profile)
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
      }
    })

    // Safety timeout — never stay loading forever
    const timeout = setTimeout(() => {
      console.warn('[Auth] Timeout — forcing load complete')
      setLoading(false)
    }, 5000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  const login = async (email: string, password: string) => {
    console.log('[Auth] login called')
    try {
      const result = await signIn(email, password)
      console.log('[Auth] login result:', result)
      if (result.error) return { error: result.error }
      if (result.profile) setUser(result.profile)
      return {}
    } catch (err) {
      console.error('[Auth] login exception:', err)
      return { error: 'Unexpected error' }
    }
  }

  const logout = async () => {
    await signOut()
    setUser(null)
  }

  const isRole = (role: Role) => user?.role === role

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-light">
        <div className="text-navy text-lg">Зареждане...</div>
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isRole }}>
      {children}
    </AuthContext.Provider>
  )
}
