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
 * Минал ли е DMARC.
 *
 * Cloudflare вече не препраща писма, които се провалят и на SPF, и на
 * DKIM — но това не доказва, че „From" е този, който твърди. Съвпадението
 * го проверява DMARC и само неговият резултат се подава нататък.
 * Не се разчита на „по подразбиране минава": липсва ли заглавката, не е pass.
 */
function dmarcResult(headers) {
  const auth = headers.get('authentication-results') ?? ''
  return /dmarc=pass/i.test(auth) ? 'pass' : 'fail'
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
        dmarc: dmarcResult(message.headers),
        text: raw,
      }),
    })

    // Логва се в „Workers → Logs". Писмото НЕ се отхвърля при грешка:
    // `message.setReject()` връща отказ на подателя, а подателят тук е
    // колега, който няма вина, че функцията е паднала.
    if (!res.ok) {
      console.error('mail-intake върна', res.status, await res.text().catch(() => ''))
    }
  },
}
