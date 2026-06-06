import { useState, useEffect, useRef, type ReactNode } from 'react'
import { AuthContext, signIn, signOut, getCurrentProfile, getCachedProfile, setCachedProfile } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { clearViewsCache } from '../../lib/views'
import { timed } from '../../lib/perf'
import type { Profile, Role } from '../../lib/types'

export function AuthProvider({ children }: { children: ReactNode }) {
  // Хидратираме от кеша → ако имаме профил, рисуваме веднага без да чакаме
  // мрежата; getCurrentProfile() по-долу го проверява/опреснява фоново.
  const [user, setUser] = useState<Profile | null>(getCachedProfile)
  const [loading, setLoading] = useState(() => getCachedProfile() === null)
  // login() сам сетва профила — този флаг казва на SIGNED_IN handler-а да не
  // дърпа профила втори път при ръчен вход.
  const loggingInRef = useRef(false)

  function applyProfile(profile: Profile | null) {
    setUser(profile)
    setCachedProfile(profile)
  }

  useEffect(() => {
    // Listen for auth changes (skip during initial load)
    let initialized = false

    timed('auth (профил)', getCurrentProfile).then(profile => {
      applyProfile(profile)
      setLoading(false)
      initialized = true
    }).catch(() => {
      applyProfile(null)
      setLoading(false)
      initialized = true
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event) => {
      if (!initialized) return
      if (event === 'SIGNED_IN') {
        if (loggingInRef.current) return
        const profile = await getCurrentProfile()
        applyProfile(profile)
      } else if (event === 'SIGNED_OUT') {
        applyProfile(null)
      }
    })

    const timeout = setTimeout(() => setLoading(false), 5000)

    // При връщане към таба след idle токенът може да е изтекъл, а застоялата
    // връзка да виси. Опресняваме сесията проактивно (вече ограничено от
    // timeout-а в supabase.ts), за да е свеж токенът преди заявките за данни и
    // да не „забива" при смяна на страница.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        supabase.auth.getSession().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const login = async (email: string, password: string) => {
    loggingInRef.current = true
    try {
      const result = await signIn(email, password)
      if (result.error) return { error: result.error }
      if (result.profile) applyProfile(result.profile)
      return {}
    } catch {
      return { error: 'Неочаквана грешка' }
    } finally {
      loggingInRef.current = false
    }
  }

  const logout = async () => {
    await signOut()
    applyProfile(null)
    // Чистим локалния кеш на изгледите — на споделен компютър следващият
    // потребител да не види чужди изгледи.
    clearViewsCache()
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
