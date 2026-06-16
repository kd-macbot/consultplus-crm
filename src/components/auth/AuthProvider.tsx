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

    // Idle-based auto-recovery: ако табът е бил скрит > 30 секунди, правим
    // soft reload при връщане. Защо такъв „агресивен" подход:
    //
    // Browser-ите често „убиват" дълготрайни HTTP/2 connections след idle.
    // Малки заявки (light SELECT-и) се възстановяват с нов connection без
    // проблем, но тежки заявки (всичките ~1500 cell_values, ~1MB payload)
    // се забиват и нашият withRetry се мъчи 4 пъти по 12 секунди = ~50s
    // преди да се откаже. През това време потребителят гледа спинър и
    // тогава ръчно прави F5.
    //
    // Health check-ове срещу леки заявки минават, но не предсказват
    // проблема при тежките — затова просто след дълъг idle reload-ваме
    // превантивно. С persisted RQ кеш + кеширан профил, reload-ът е
    // практически мигновен (без login, без login).
    //
    // Защити:
    //  - Само ако сме били скрити > 30s (бързи смени на таб не реагират).
    //  - Само ако сме логнати.
    //  - 60s backoff между два reload-а (избягва tight loop).
    const RELOAD_BACKOFF_MS = 60_000
    const IDLE_THRESHOLD_MS = 30_000
    const RELOAD_TS_KEY = 'auth-idle-reload-ts'
    let hiddenAt: number | null = null

    const onVisChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      // visible
      if (!hiddenAt) return
      const idleMs = Date.now() - hiddenAt
      hiddenAt = null
      if (idleMs < IDLE_THRESHOLD_MS) {
        console.log(`[auth] tab return след ${Math.round(idleMs / 1000)}s — OK`)
        return
      }
      const cachedProfile = getCachedProfile()
      if (!cachedProfile) return

      const lastReloadStr = sessionStorage.getItem(RELOAD_TS_KEY)
      const lastReload = lastReloadStr ? parseInt(lastReloadStr, 10) : 0
      if (Date.now() - lastReload < RELOAD_BACKOFF_MS) {
        console.warn(`[auth] tab idle ${Math.round(idleMs / 1000)}s — но reload backoff активен`)
        return
      }
      try { sessionStorage.setItem(RELOAD_TS_KEY, String(Date.now())) } catch { /* ignore */ }
      console.warn(`[auth] tab idle ${Math.round(idleMs / 1000)}s → soft reload`)
      window.location.reload()
    }
    document.addEventListener('visibilitychange', onVisChange)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
      document.removeEventListener('visibilitychange', onVisChange)
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
