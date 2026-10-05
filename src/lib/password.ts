// ============================================================
// Генератор на временни пароли — за „Създай акаунт" и
// „Нулирай парола" в Персонал.
//
// Паролата се ЧЕТЕ НА ГЛАС или се преписва: админът я казва на
// колегата по телефона или я пише в съобщение. Затова от азбуката
// са махнати знаците, които се бъркат при четене и преписване:
//   0 O o   1 l I   5 S s   2 Z z   8 B
// Една сбъркана буква значи „не мога да вляза" и втори разговор.
// ============================================================

/** Азбуката е нарочно без бъркащи се знаци (виж по-горе). */
const UPPER = 'ACDEFGHJKLMNPQRTUVWXY'
const LOWER = 'acdefghjkmnpqrtuvwxy'
const DIGITS = '34679'
const SYMBOLS = '!@#$%*-+='

export const PASSWORD_ALPHABET = UPPER + LOWER + DIGITS + SYMBOLS

/** По подразбиране 14 знака — дълга, но още преписваема. */
export const DEFAULT_PASSWORD_LENGTH = 14

/**
 * Случайни байтове през `crypto` — НЕ `Math.random()`.
 * Паролата отваря чужд акаунт; предвидим генератор не върши работа.
 */
function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}

/**
 * Избира знак от азбука БЕЗ отклонение.
 *
 * Наивното `byte % alphabet.length` прави първите знаци малко
 * по-вероятни, когато 256 не се дели на дължината. Затова байтовете
 * извън последния пълен кръг се отхвърлят и се тегли наново.
 */
function pick(alphabet: string): string {
  const limit = Math.floor(256 / alphabet.length) * alphabet.length
  for (;;) {
    const b = randomBytes(1)[0]
    if (b < limit) return alphabet[b % alphabet.length]
  }
}

/**
 * Генерира парола с ПОНЕ по един знак от всяка група.
 *
 * Без това изискване на всеки N-ти път излиза парола само от букви —
 * изглежда слаба и някои системи я отказват.
 */
export function generatePassword(length = DEFAULT_PASSWORD_LENGTH): string {
  const len = Math.max(8, Math.floor(length))
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)]
  while (chars.length < len) chars.push(pick(PASSWORD_ALPHABET))

  // Разбъркване (Fisher-Yates) — иначе първите четири знака винаги са
  // в един и същ ред: главна, малка, цифра, знак.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

/** Съдържа ли паролата знак, който се бърка при преписване? */
export function hasConfusingChars(pw: string): boolean {
  return /[0O o1lI5Ss2Zz8B]/.test(pw)
}

/** Минималната дължина, която приема и edge функцията. */
export const MIN_PASSWORD_LENGTH = 6

export function isAcceptablePassword(pw: string): boolean {
  return (pw ?? '').length >= MIN_PASSWORD_LENGTH
}
