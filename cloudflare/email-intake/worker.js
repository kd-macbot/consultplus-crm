/**
 * Cloudflare Email Worker — input@cplus360.com → edge функцията mail-intake.
 *
 * НАРОЧНО Е ТЪНЪК. Тук не се взема нито едно решение: Worker-ът чете
 * писмото, вади трите неща, които трябват, и ги подава нататък. Цялата
 * логика (кой има право, къде отива, какво се приема) живее на ЕДНО
 * място — в едж функцията, където може да се тества и да се деплойва,
 * без да се пипа Cloudflare.
 *
 * НАСТРОЙКА (веднъж):
 *   1. Workers & Pages → Create → Worker → постави този файл
 *   2. Settings → Variables and Secrets:
 *        INTAKE_URL    = https://<project-ref>.supabase.co/functions/v1/mail-intake
 *        INTAKE_SECRET = същият низ като secret-а на функцията
 *   3. Email Routing → Routing rules → Create address
 *        input@cplus360.com → Action: Send to a Worker → този Worker
 *
 * ⚠️ Email Routing иска Cloudflare DNS и платен Workers план.
 */

/** Чете поток в текст, с таван — писмо с прикачен файл може да е огромно. */
async function readBody(stream, limit) {
  const reader = stream.getReader()
  const chunks = []
  let size = 0
  while (size < limit) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
  }
  try { await reader.cancel() } catch { /* потокът вече е свършил */ }
  const joined = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { joined.set(c, at); at += c.length }
  return new TextDecoder('utf-8').decode(joined).slice(0, limit)
}

/**
 * Суровата заглавка за автентичност, каквато е.
 *
 * Worker-ът НЕ преценява. Първата версия решаваше сама „минал ли е DMARC" —
 * моя непоследователност спрямо собствения ѝ замисъл. Решението живее в
 * едж функцията (`senderProven`, тествано), за да е на едно място и да се
 * мени без да се пипа Cloudflare.
 */
function authResults(headers) {
  return headers.get('authentication-results') ?? ''
}

/**
 * Какво вижда Worker-ът за автентичността — за ЛОГА, не за решение.
 *
 * Отказът „подателят не е доказан" не различава две съвсем различни неща:
 * заглавка НЯМА, или заглавката казва нещо друго. Без това отвън и двете
 * изглеждат еднакво и се гадае. Същият клас грешка като при `res.ok` и
 * 202 — нещо се проваля и мълчи за причината.
 *
 * Логват се ИМЕНАТА на всички заглавки (кратко, показва какво ИМА) и
 * стойността само на онези, които говорят за автентичност. Самото писмо
 * не влиза в лога. Стойностите носят IP на подателя — това е лог на
 * Cloudflare за писмо, което Cloudflare вече е обработил, не нова изнесена
 * информация.
 */
function authDebug(headers) {
  const names = []
  const values = {}
  for (const [name] of headers) {
    names.push(name)
    if (/auth|spf|dkim|dmarc/.test(name)) {
      values[name] = (headers.get(name) ?? '').slice(0, 300)
    }
  }
  return { names, values }
}

export default {
  async email(message, env) {
    // Писмото се чете СУРОВО (с всичките заглавки на препратеното).
    // Разборът на MIME е работа на извличането, не на Worker-а.
    const raw = await readBody(message.raw, 100_000)

    const res = await fetch(env.INTAKE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-intake-secret': env.INTAKE_SECRET,
      },
      body: JSON.stringify({
        from: message.from,
        subject: message.headers.get('subject') ?? '',
        auth: authResults(message.headers),
        text: raw,
      }),
    })

    // ЛОГВА СЕ ВИНАГИ, не само при грешка.
    //
    // Първата версия логваше само при `!res.ok` — а `res.ok` е ВЯРНО и за
    // 202, с който функцията нарочно пропуска писмо („DMARC не е минал",
    // „подателят не е от кантората", „темата не съдържа ключовата дума").
    // Тоест всички съзнателни откази минаваха мълчаливо и отвън изглеждаше
    // като „Worker-ът тръгна, outcome ok, а ред няма" — загадка без следа.
    // Обемът е няколко писма на ден; един ред на писмо не е цена.
    //
    // Тялото не съдържа писмото: при успех е {created, name}, при пропуск —
    // причината, при грешка — съобщението.
    const answer = await res.text().catch(() => '(тялото не се прочете)')
    if (res.ok) {
      console.log('mail-intake', res.status, answer)
    } else {
      console.error('mail-intake ГРЕШКА', res.status, answer)
    }

    // Следата за автентичността се логва ВИНАГИ, не само при пропуск:
    // причината за отказ трябва да се вижда в същото пускане, в което е
    // станал, а не след нов деплой и ново писмо.
    console.log('mail-intake auth', JSON.stringify(authDebug(message.headers)))

    // Писмото НЕ се отхвърля при грешка: `message.setReject()` връща отказ
    // на подателя, а подателят тук е колега, който няма вина.
  },
}
