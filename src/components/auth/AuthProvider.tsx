import { useState, useEffect, useRef, type ReactNode } from 'react'
import {
  AuthContext, signIn, signOut, resolveSession, completeOAuthRedirect,
  signInWithMicrosoft, getCachedProfile, setCachedProfile,
} from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { clearViewsCache } from '../../lib/views'
import { attemptAutoReload } from '../../lib/recovery'
import { timed } from '../../lib/perf'
import type { Profile, Role } from '../../lib/types'

export function AuthProvider({ children }: { children: ReactNode }) {
  // Хидратираме от кеша → ако имаме профил, рисуваме веднага без да чакаме
  // мрежата; resolveSession() по-долу го проверява/опреснява фоново.
  const [user, setUser] = useState<Profile | null>(getCachedProfile)
  const [loading, setLoading] = useState(() => getCachedProfile() === null)
  // login() сам сетва профила — този флаг казва на SIGNED_IN handler-а да не
  // дърпа профила втори път при ръчен вход.
  const loggingInRef = useRef(false)
  // Защо не се влиза — пише се и от връщането от Microsoft, и от
  // проверката на профила. Показва се на екрана за вход.
  const [authError, setAuthError] = useState<string | null>(null)

  function applyProfile(profile: Profile | null) {
    setUser(profile)
    setCachedProfile(profile)
  }

  useEffect(() => {
    // Listen for auth changes (skip during initial load)
    let initialized = false

    // РЕДЪТ Е ВАЖЕН: първо се обменя кодът от Microsoft (ако адресът го
    // носи), после се чете профилът. Обратното би прочело профила още без
    // сесия и колегата щеше да види екрана за вход въпреки успешния вход.
    const boot = async () => {
      const redirect = await completeOAuthRedirect()
      if (redirect.error) setAuthError(redirect.error)
      const { profile, error } = await resolveSession()
      if (error) setAuthError(error)
      return profile
    }

    timed('auth (профил)', boot).then(profile => {
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
        const { profile, error } = await resolveSession()
        if (error) setAuthError(error)
        applyProfile(profile)
      } else if (event === 'SIGNED_OUT') {
        applyProfile(null)
      }
    })

    const timeout = setTimeout(() => setLoading(false), 5000)

    // Auto-recovery: два независими trigger-а, които довеждат до soft reload
    // (с общ backoff от 60s да не loop-ват). И двата targetпат един и същ
    // проблем — счупен HTTP/2 connection след idle, при който тежки заявки
    // се забиват за десетки секунди.
    //
    // TRIGGER 1 (превантивен): tab idle > 30s → reload при връщане.
    //   Малки заявки минават след reconnect, но 1MB+ отговори висят. Не
    //   чакаме, превантивно reload-ваме при дълъг idle.
    //
    // TRIGGER 2 (реактивен): React Query заявка, която тегли > 12 секунди.
    //   Дори да не сме били идле, но cells/моntly_work е забит — detect-
    //   ваме и reload-ваме, без да чакаме 50-те секунди.
    //
    // Reload-ът е практически мигновен (persisted RQ кеш + кеширан профил
    // → екран рисуван веднага, без login).
    const IDLE_THRESHOLD_MS = 30_000
    const STUCK_QUERY_THRESHOLD_MS = 12_000
    let hiddenAt: number | null = null

    // ── TRIGGER 1: tab visibility ───────────────────────────────
    const onVisChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      if (!hiddenAt) return
      const idleMs = Date.now() - hiddenAt
      hiddenAt = null
      if (idleMs < IDLE_THRESHOLD_MS) {
        return
      }
      if (!getCachedProfile()) return
      attemptAutoReload(`idle ${Math.round(idleMs / 1000)}s`)
    }
    document.addEventListener('visibilitychange', onVisChange)

    // ── TRIGGER 2: stuck React Query ────────────────────────────
    // Tracking fetch start time за всяка заявка. Ако някоя тегли > 12s,
    // считаме я за забита.
    const fetchStartTimes = new Map<string, number>()

    const unsubQueryCache = queryClient.getQueryCache().subscribe((event) => {
      const query = event.query
      const key = JSON.stringify(query.queryKey)
      if (query.state.fetchStatus === 'fetching') {
        if (!fetchStartTimes.has(key)) fetchStartTimes.set(key, Date.now())
      } else {
        fetchStartTimes.delete(key)
      }
    })

    const stuckCheckInterval = window.setInterval(() => {
      if (!getCachedProfile()) return
      const now = Date.now()
      for (const [key, started] of fetchStartTimes) {
        const ageMs = now - started
        if (ageMs > STUCK_QUERY_THRESHOLD_MS) {
          fetchStartTimes.delete(key)  // изчистваме веднага, за да не повторим
          attemptAutoReload(`stuck query ${Math.round(ageMs / 1000)}s: ${key}`)
          return
        }
      }
    }, 2_000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
      document.removeEventListener('visibilitychange', onVisChange)
      unsubQueryCache()
      clearInterval(stuckCheckInterval)
    }
  }, [])

  const login = async (email: string, password: string) => {
    loggingInRef.current = true
    setAuthError(null)
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

  // Връща {} при успех само защото ПРЕНАСОЧВА — кодът след него не се
  // изпълнява. Грешка идва единствено ако самото пренасочване не стане.
  const loginWithMicrosoft = async () => {
    setAuthError(null)
    const result = await signInWithMicrosoft()
    if (result.error) setAuthError(result.error)
    return result
  }

  const logout = async () => {
    setAuthError(null)
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
        <div className="text-navy dark:text-foreground text-lg">Зареждане...</div>
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{
      user, loading, login, loginWithMicrosoft, logout, isRole,
      authError, clearAuthError: () => setAuthError(null),
    }}>
      {children}
    </AuthContext.Provider>
  )
}
