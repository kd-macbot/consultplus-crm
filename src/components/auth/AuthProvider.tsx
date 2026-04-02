import { useState, useEffect, type ReactNode } from 'react'
import { AuthContext, signIn, signOut, getCurrentProfile } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import type { Profile, Role } from '../../lib/types'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check initial session
    getCurrentProfile().then(profile => {
      setUser(profile)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_IN') {
        const profile = await getCurrentProfile()
        setUser(profile)
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const login = async (email: string, password: string) => {
    const result = await signIn(email, password)
    if (result.error) return { error: result.error }
    if (result.profile) setUser(result.profile)
    return {}
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
