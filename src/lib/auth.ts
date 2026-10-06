import { createContext, useContext } from 'react'
import { supabase } from './supabase'
import {
  verifySession, readOAuthRedirect, describeOAuthError, NO_PROFILE_MESSAGE,
} from './session'
import type { Profile, Role } from './types'

export interface AuthState {
  user: Profile | null
  loading: boolean
  login: (email: string, password: string) => Promise<{ error?: string }>
  loginWithMicrosoft: () => Promise<{ error?: string }>
  logout: () => Promise<void>
  isRole: (role: Role) => boolean
  /** Защо не се влиза — включително след връщане от Microsoft. */
  authError: string | null
  clearAuthError: () => void
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: error.message }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single()

  // Решението е ЕДНО (verifySession) и за парола, и за Microsoft — преди
  // проверката на is_active стоеше само тук и другият път я нямаше.
  const row = profileError || !profile ? null : (profile as Profile)
  const verdict = verifySession(true, row)
  if (verdict.status !== 'ok' || !row) {
    // Сесия без достъп НЕ се оставя да виси — иначе приложението се върти
    // между екрана за вход и празен профил.
    await supabase.auth.signOut()
    return { error: verdict.status === 'denied' ? verdict.reason : NO_PROFILE_MESSAGE }
  }
  return { profile: row }
}

// ============================================================
// Вход с Microsoft (Office 365) — Azure провайдър в Supabase Auth
// ============================================================
//
// Microsoft казва САМО „този човек е той". Правата идват от `profiles`,
// тоест акаунтът пак се прави от админ в Персонал. Колега от 365 без
// профил получава сесия, но не влиза (verifySession → denied).
//
// Самоличностите се слепват по ИМЕЙЛ — Supabase добавя azure identity към
// заварения потребител (проверено на dev 06.10.2026: едно `auth.users.id`,
// два реда в `auth.identities`). Затова имейлът в Персонал трябва да е
// същият като в 365; различен имейл = ОТДЕЛЕН потребител без профил.
export async function signInWithMicrosoft(): Promise<{ error?: string }> {
  // Връщаме се в КОРЕНА, без фрагмент: Supabase добавя `?code=...`, а
  // HashRouter-ът си слага `#/...` след него.
  const redirectTo = `${window.location.origin}${window.location.pathname}`
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: { scopes: 'openid email profile', redirectTo },
  })
  if (error) return { error: error.message }
  return {}
}

/**
 * Обменя `?code=...` от адреса за сесия. Вика се ВЕДНЪЖ, при зареждане.
 *
 * Клиентът е с `detectSessionInUrl: false` нарочно (да не рови в адреса на
 * всяко зареждане), затова обмяната е изрична. Адресът се изчиства и в
 * двата случая: кодът не бива да остава в историята на браузъра, а
 * грешката — да изскача пак при refresh.
 */
export async function completeOAuthRedirect(): Promise<{ error?: string }> {
  const incoming = readOAuthRedirect(window.location.search)
  if (incoming.kind === 'none') return {}

  try {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
  } catch {
    /* без значение — обмяната е по-важна от чистия адрес */
  }

  if (incoming.kind === 'error') return { error: incoming.message }

  const { error } = await supabase.auth.exchangeCodeForSession(incoming.code)
  if (error) return { error: describeOAuthError('', error.message) }
  return {}
}

export async function adminCreateUser(
  email: string,
  password: string,
  full_name: string,
  role: Role
): Promise<{ error?: string; userId?: string; adopted?: boolean }> {
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
    // `adopted` = имейлът е бил зает от потребител БЕЗ профил (колегата е
    // пробвал „Вход с Microsoft" преди акаунта) и функцията го е поела.
    return { userId: data.userId, adopted: data.adopted === true }
  } catch (err) {
    return { error: (err as Error).message ?? 'Грешка при създаване на потребител' }
  }
}

/**
 * Нулира паролата на СЪЩЕСТВУВАЩ потребител (само admin).
 *
 * Същата edge функция като създаването, с `action: 'reset_password'` —
 * нова функция би значела още един ръчен деплой и още secrets.
 *
 * ⚠️ РЕД НА ПУСКАНЕ: функцията се предеплойва ПРЕДИ този код да стигне
 * до live. Удари ли старата функция, тя ще пренебрегне `action`, ще се
 * опита да СЪЗДАДЕ потребител със зает имейл и ще върне „User already
 * registered". Объркващо, но безвредно — нищо не се променя.
 */
export async function adminResetPassword(
  email: string,
  password: string,
): Promise<{ error?: string; userId?: string }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return { error: 'Не сте логнат' }

  try {
    const { data, error } = await supabase.functions.invoke('admin-create-user', {
      body: { action: 'reset_password', email, password },
    })
    if (error) return { error: error.message }
    if (data?.error) return { error: data.error }
    if (!data?.userId) return { error: 'Неочакван отговор от сървъра' }
    return { userId: data.userId }
  } catch (err) {
    return { error: (err as Error).message ?? 'Грешка при нулиране на паролата' }
  }
}

export async function signOut() {
  await supabase.auth.signOut()
}

// Кеш на профила в localStorage — за мигновен студен старт. При отваряне
// рисуваме веднага от кеша, а getCurrentProfile() го опреснява фоново.
const PROFILE_CACHE_KEY = 'consultplus-profile'

export function getCachedProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY)
    return raw ? (JSON.parse(raw) as Profile) : null
  } catch {
    return null
  }
}

export function setCachedProfile(profile: Profile | null): void {
  try {
    if (profile) localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile))
    else localStorage.removeItem(PROFILE_CACHE_KEY)
  } catch {
    /* localStorage недостъпен — игнорирай */
  }
}

/**
 * Текущата сесия → профил, или обяснение защо не се пуска.
 *
 * Замени getCurrentProfile(), който връщаше само профила и затова не
 * можеше да различи „няма сесия" от „има сесия, но няма достъп". През
 * него минават И първоначалното зареждане, И събитието SIGNED_IN (тоест
 * и входът с Microsoft) — там проверката на is_active я нямаше.
 */
export async function resolveSession(): Promise<{ profile: Profile | null; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return { profile: null }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()

    // РАЗЛИКАТА Е СЪЩЕСТВЕНА: „няма такъв ред" (PGRST116) значи акаунт без
    // достъп и сесията се прекратява. Всичко друго е проблем с мрежата —
    // тогава НЕ пипаме сесията, иначе един забит отговор щеше да изхвърли
    // всички колеги.
    if (error && error.code !== 'PGRST116') return { profile: null }

    const row = error || !data ? null : (data as Profile)
    const verdict = verifySession(true, row)
    if (verdict.status === 'denied') {
      await supabase.auth.signOut()
      return { profile: null, error: verdict.reason }
    }
    return { profile: row }
  } catch {
    return { profile: null }
  }
}

export const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  login: async () => ({}),
  loginWithMicrosoft: async () => ({}),
  logout: async () => {},
  isRole: () => false,
  authError: null,
  clearAuthError: () => {},
})

export const useAuth = () => useContext(AuthContext)
