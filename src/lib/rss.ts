// Разбор на RSS/Atom феед — чиста логика, БЕЗ мрежа.
//
// ⚠️ ТОЗИ ФАЙЛ Е ОГЛЕДАЛО на разбора в `supabase/functions/news-fetch`.
// Edge функцията е един самостоятелен файл нарочно (деплойва се ръчно през
// Dashboard, а многофайлов импорт там е мъчение), затова кодът е ПОВТОРЕН.
// Тук живее тестваното копие: пипнеш ли регулярен израз от едната страна,
// пипни го и от другата. Същата уговорка като при mail-send.
//
// Защо изобщо се разбира с регулярни изрази, а не с XML парсер: Deno няма
// вграден такъв, а вкарването на модул би направило функцията многофайлова.

export interface FeedItem {
  title: string
  link: string
  summary: string
  /** ISO дата или null, ако феедът не дава четима. */
  published: string | null
}

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    // &amp; НАКРАЯ — иначе „&amp;lt;" би станало „<" вместо „&lt;".
    .replace(/&amp;/g, '&')
}

export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** Съдържанието на първия <tag>…</tag> в парчето. */
export function tagText(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))
  return m ? decodeEntities(m[1]).trim() : ''
}

export function attr(tagStr: string, name: string): string {
  const m = tagStr.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'))
  return m ? m[1] : ''
}

export function absolute(href: string, base: string): string {
  try {
    return new URL(href, base).toString()
  } catch {
    return href
  }
}

export function looksLikeFeed(body: string, contentType: string): boolean {
  if (/(rss|atom)\+xml|text\/xml|application\/xml/.test(contentType)) return true
  const head = body.slice(0, 2000)
  return /<rss[\s>]/i.test(head) || /<feed[\s>]/i.test(head) || /<rdf:RDF[\s>]/i.test(head)
}

/** <link rel="alternate" type="application/rss+xml" href="…"> в HTML-а. */
export function findFeedLink(html: string, base: string): string | null {
  const links = html.match(/<link\b[^>]*>/gi) ?? []
  for (const l of links) {
    if (!/(rss|atom)\+xml/.test(attr(l, 'type').toLowerCase())) continue
    const href = attr(l, 'href')
    if (href) return absolute(href, base)
  }
  return null
}

export function parseDate(raw: string): string | null {
  if (!raw) return null
  const t = Date.parse(raw.trim())
  return isNaN(t) ? null : new Date(t).toISOString()
}

/**
 * Извлича новините от RSS 2.0 или Atom. Редът е най-новите отгоре —
 * феедовете обикновено са така, но не всички.
 *
 * Ред без заглавие ИЛИ без линк се пропуска: линкът е единственото, което
 * води до оригинала, а без него новината е слух.
 */
export function parseFeed(xml: string, base: string): FeedItem[] {
  const isAtom = /<feed[\s>]/i.test(xml.slice(0, 2000))
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) ?? []
  const out: FeedItem[] = []

  for (const b of blocks) {
    const title = stripTags(tagText(b, 'title'))
    let link = ''
    if (isAtom) {
      // Atom: линкът е в атрибут. Предпочита се rel="alternate".
      const links = b.match(/<link\b[^>]*>/gi) ?? []
      const alt = links.find(l => (attr(l, 'rel') || 'alternate').toLowerCase() === 'alternate') ?? links[0]
      if (alt) link = attr(alt, 'href')
    } else {
      link = tagText(b, 'link') || tagText(b, 'guid')
    }
    link = link ? absolute(link.trim(), base) : ''

    const summaryRaw = isAtom
      ? (tagText(b, 'summary') || tagText(b, 'content'))
      : (tagText(b, 'description') || tagText(b, 'content:encoded'))

    const published = parseDate(
      isAtom
        ? (tagText(b, 'published') || tagText(b, 'updated'))
        : (tagText(b, 'pubDate') || tagText(b, 'dc:date')),
    )

    if (!title || !link) continue
    out.push({ title, link, summary: stripTags(summaryRaw), published })
  }

  out.sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''))
  return out
}

/** Реже до n знака с многоточие; не оставя увиснал интервал. */
export function clip(s: string, n: number): string {
  const t = (s ?? '').trim()
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + '…'
}

// ============================================================
// Четене на СПИСЪЧНА СТРАНИЦА, когато сайтът няма феед
// ============================================================
// Български институционални сайтове (НАП, КиК Инфо) не публикуват RSS.
// Затова новините се вадят от самата страница.
//
// БЕЗ ръчно настроен шаблон за всеки сайт: такъв трябва да се поддържа и
// се чупи тихо. Вместо това се ползва това, което всяка списъчна страница
// има по устройство — МНОГО връзки с ДЪЛЪГ текст, сочещи към ЕДНА И СЪЩА
// част от сайта. Менюто, футърът и рекламите имат кратък текст и водят
// навсякъде; заглавията на новини са дълги и споделят обща пътека.
//
// Затова: взимат се връзките с достатъчно дълъг текст, групират се по
// първата част от пътеката и печели най-многолюдната група.

/** Под този праг текстът е меню („Вход", „За нас"), не заглавие. */
const MIN_TITLE_LEN = 25
const MAX_TITLE_LEN = 300
/** Под три връзки не е списък, а съвпадение. */
const MIN_GROUP = 3

export interface PageLink { title: string; link: string }

/** Всички <a href> с техния текст, в реда на страницата. */
export function extractAnchors(html: string, base: string): PageLink[] {
  const out: PageLink[] = []
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const href = m[1].trim()
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) continue
    const title = stripTags(m[2])
    if (title.length < MIN_TITLE_LEN || title.length > MAX_TITLE_LEN) continue
    out.push({ title, link: absolute(href, base) })
  }
  return out
}

/** Първата част от пътеката: „/novini/12345/…" → „/novini". */
function pathGroup(url: string): string {
  try {
    const p = new URL(url).pathname.split('/').filter(Boolean)
    return '/' + (p[0] ?? '')
  } catch {
    return ''
  }
}

/**
 * Новините от списъчна страница. Връща ги в реда на страницата — най-горе
 * обикновено е най-новото, а дата от такава страница не се вади надеждно.
 */
export function extractListing(html: string, base: string): FeedItem[] {
  let origin = ''
  try { origin = new URL(base).origin } catch { origin = '' }

  const seen = new Set<string>()
  const anchors = extractAnchors(html, base).filter(a => {
    // Само вътрешни връзки: външните са реклами и партньори.
    if (origin && !a.link.startsWith(origin)) return false
    // Връзка към самата страница не е новина.
    if (a.link.replace(/\/$/, '') === base.replace(/\/$/, '')) return false
    if (seen.has(a.link)) return false
    seen.add(a.link)
    return true
  })

  const groups = new Map<string, PageLink[]>()
  for (const a of anchors) {
    const g = pathGroup(a.link)
    const list = groups.get(g) ?? []
    list.push(a)
    groups.set(g, list)
  }

  let best: PageLink[] = []
  for (const list of groups.values()) {
    if (list.length > best.length) best = list
  }
  if (best.length < MIN_GROUP) best = anchors

  return best.map(a => ({ title: a.title, link: a.link, summary: '', published: null }))
}
