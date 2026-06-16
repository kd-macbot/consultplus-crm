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

    // При връщане към таба: HEALTH CHECK с истинска мрежова заявка срещу 5s
    // timeout. Това хваща два различни проблема:
    //  (а) Web Lock в supabase-js увиснал при token refresh.
    //  (б) Stale HTTPS connection — TCP връзката умряла докато табът е спял.
    //
    // И в двата случая, всяка следваща заявка ще timeout-ва с „Заявката
    // изтече". Health check-ът ги детектира предварително; soft reload-ът
    // ги решава автоматично, без потребителят да си спомня за F5.
    //
    // ВАЖНО: getSession() НЕ струва — върна кеширания токен без мрежа.
    // Затова правим лек select от crm_columns (HEAD-only, без данни).
    //
    // Защити:
    //  - Throttle: max един health check на 20 секунди.
    //  - Reload guard: сесионен флаг, който прави max един auto-reload.
    //    Ако след reload-а проблемът се повтори → не reload-ваме отново
    //    (избягваме безкраен цикъл при upstream проблем).
    //  - Health check се прави САМО ако потребителят е логнат — на login
    //    страницата RLS би хвърлила грешка, която не значи „забит клиент".
    let lastHealthCheck = 0
    const HEALTH_THROTTLE_MS = 20_000
    const HEALTH_TIMEOUT_MS = 5_000
    const SESSION_RELOAD_FLAG = 'auth-stuck-reload-done'

    const onWake = () => {
      if (document.visibilityState !== 'visible') return
      const cachedProfile = getCachedProfile()
      if (!cachedProfile) return  // не сме логнати — не правим health check
      const now = Date.now()
      if (now - lastHealthCheck < HEALTH_THROTTLE_MS) return
      lastHealthCheck = now

      let timer: ReturnType<typeof setTimeout> | undefined
      console.debug('[auth] health check…')
      Promise.race<unknown>([
        // Лека мрежова проверка — HEAD-only, без редове.
        supabase.from('crm_columns')
          .select('id', { count: 'exact', head: true })
          .then(({ error }) => { if (error) throw error }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('health-timeout')), HEALTH_TIMEOUT_MS)
        }),
      ]).then(
        () => {
          if (timer) clearTimeout(timer)
          console.debug('[auth] health check OK')
        },
        (err) => {
          if (timer) clearTimeout(timer)
          console.warn('[auth] health check FAILED:', (err as Error).message)
          // Ако вече сме reload-вали в тази session — не правим втори опит,
          // за да избегнем безкраен цикъл.
          if (sessionStorage.getItem(SESSION_RELOAD_FLAG) === '1') {
            console.warn('[auth] reload вече направен в тази сесия — пропускам')
            return
          }
          try { sessionStorage.setItem(SESSION_RELOAD_FLAG, '1') } catch { /* ignore */ }
          console.warn('[auth] soft reload')
          window.location.reload()
        },
      )
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
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
