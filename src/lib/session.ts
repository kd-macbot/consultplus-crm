// ============================================================
// Решение „пуска ли се този човек вътре" — чиста логика, без мрежа.
//
// ЗАЩО ОТДЕЛЕН ФАЙЛ: проверката на `is_active` стоеше САМО в signIn()
// (вход с имейл и парола). Първоначалното зареждане и събитието
// SIGNED_IN минаваха през getCurrentProfile(), което флага не го гледа.
// Следствието: деактивиран колега с отворена сесия си оставаше вътре и
// след refresh, а входът с Microsoft (нов вход по ДРУГИЯ път) щеше да го
// пусне направо. Сега решението е ЕДНО и всички пътища минават през него.
// ============================================================

export type SessionVerdict =
  | { status: 'anonymous' }
  | { status: 'ok' }
  | { status: 'denied'; reason: string }

/** Текстовете са за екрана за вход — колегата трябва да разбере какво да прави. */
export const NO_PROFILE_MESSAGE =
  'Този акаунт няма достъп до Consult Plus 360. Обърнете се към администратор.'
export const DEACTIVATED_MESSAGE =
  'Акаунтът е деактивиран. Свържете се с администратор.'

/**
 * `hasSession` — има ли валидна сесия в Supabase.
 * `profile` — редът от `profiles` за този потребител (null = няма ред).
 *
 * „Има сесия, няма профил" е нормалният случай при Microsoft вход на човек,
 * на когото никой не е правил акаунт — Supabase създава потребителя, но
 * профил и права се дават само от админ. Пуска се навън с обяснение, а не
 * тихо на екрана за вход (сесията иначе остава и примката се върти).
 */
export function verifySession(
  hasSession: boolean,
  profile: { is_active?: boolean } | null
): SessionVerdict {
  if (!hasSession) return { status: 'anonymous' }
  if (!profile) return { status: 'denied', reason: NO_PROFILE_MESSAGE }
  if (profile.is_active === false) return { status: 'denied', reason: DEACTIVATED_MESSAGE }
  return { status: 'ok' }
}

// ============================================================
// Разбор на отговора след redirect от Microsoft
// ============================================================
//
// Приложението е на HashRouter, затова адресът изглежда така:
//   https://cplus360.com/?code=abc123#/login
//   https://cplus360.com/?error=server_error&error_description=...#/login
// Query-то стои ПРЕДИ фрагмента, тоест `location.search` го хваща, а
// рутерът не се бие с него. Точно заради това клиентът е с flowType
// 'pkce': при 'implicit' токените идват във ФРАГМЕНТА и се застъпват с
// адресите на рутера.

export type OAuthRedirect =
  | { kind: 'none' }
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string }

/** Познатите грешки — на човешки. Непознатите минават както са. */
const ERROR_TRANSLATIONS: Array<[RegExp, string]> = [
  [
    /error getting user email/i,
    'Microsoft не върна имейл адрес за този акаунт. Обърнете се към администратор.',
  ],
  [
    /access_denied|user (cancel|denied)/i,
    'Входът с Microsoft беше прекратен.',
  ],
  [
    /email.*(not confirmed|already)/i,
    'Имейлът от Microsoft не съвпада с акаунт в системата. Обърнете се към администратор.',
  ],
]

export function describeOAuthError(code: string, description: string): string {
  const text = `${code} ${description}`.trim()
  for (const [pattern, friendly] of ERROR_TRANSLATIONS) {
    if (pattern.test(text)) return friendly
  }
  if (description.trim()) return `Входът с Microsoft не стана: ${description.trim()}`
  return 'Входът с Microsoft не стана. Опитайте пак или влезте с парола.'
}

/**
 * `search` е `location.search` (с или без водещото „?").
 * Връща какво носи адресът — код за обмяна, грешка или нищо.
 */
export function readOAuthRedirect(search: string): OAuthRedirect {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)

  const errorCode = params.get('error') ?? params.get('error_code') ?? ''
  const errorDescription = params.get('error_description') ?? ''
  if (errorCode || errorDescription) {
    return { kind: 'error', message: describeOAuthError(errorCode, errorDescription) }
  }

  const code = params.get('code')
  if (code) return { kind: 'code', code }

  return { kind: 'none' }
}
