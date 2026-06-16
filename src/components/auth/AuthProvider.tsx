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

    // При връщане към таба след idle: правим HEALTH CHECK на supabase сесията
    // с твърд timeout. Ако auth refresh-ът е увиснал в navigator.locks (познат
    // проблем на supabase-js, който се случваше когато браузърът заспие таба),
    // нашата заявка ще се прекъсне след 5 секунди и ще направим soft reload —
    // абсолютно същото нещо, което потребителят правеше ръчно с F5.
    //
    // Защити срещу false-positive:
    //  - Пропускаме бързи смени на таб (под 30 сек невидим).
    //  - Reload-ваме само веднъж в една сесия (sessionStorage guard).
    let hiddenAt: number | null = null

    const onVisible = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      // visible — проверяваме дали табът е бил скрит достатъчно дълго
      const idleMs = hiddenAt ? Date.now() - hiddenAt : 0
      hiddenAt = null
      if (idleMs < 30_000) {
        // Бърза смяна на таб — само освежаваме session-а, не правим health check.
        supabase.auth.getSession().catch(() => {})
        return
      }

      // Бил е скрит > 30s → правим health check срещу 5s timeout.
      let timer: ReturnType<typeof setTimeout> | undefined
      Promise.race<unknown>([
        supabase.auth.getSession(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('auth-stuck')), 5_000)
        }),
      ]).then(
        () => { if (timer) clearTimeout(timer) },
        () => {
          // Supabase клиентът е „забит" — спасяваме потребителя със soft reload.
          if (sessionStorage.getItem('auth-stuck-reload') === '1') return
          try { sessionStorage.setItem('auth-stuck-reload', '1') } catch { /* ignore */ }
          console.warn('Supabase auth check timed out → soft reload')
          setTimeout(() => {
            try { sessionStorage.removeItem('auth-stuck-reload') } catch { /* ignore */ }
            window.location.reload()
          }, 100)
        },
      )
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
