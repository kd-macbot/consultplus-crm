// Supabase Edge Function: news-fetch — новини от бранша (RSS/Atom).
//
// Един файл нарочно (deploy-ва се ръчно през Dashboard, както другите).
//
// Deploy:
//   supabase functions deploy news-fetch --no-verify-jwt
//   secrets: NOTIFY_CRON_SECRET (същият като при mail-send)
//
// Самоличност (както mail-send): admin/Управление JWT ИЛИ x-cron-secret.
//
// Действия:
//   { action: "check", url }        → пробва адреса, открива фееда, връща
//                                     какво е намерил (за бутона „Провери")
//   { action: "run", dry_run?: true } → чете включените извори и добавя
//                                     новини; dry_run само ги връща
//
// ⚠️ НИКАКЪВ ПРЕРАЗКАЗ. Заглавието и резюмето се пазят ТАКА, КАКТО ги
// дава източникът, плюс линк към оригинала. Счетоводна новина, минала
// през преразказ, е задължение: сгрешен срок или ставка стига да подведе
// колега, който го прилага на клиент.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

// Някои сайтове отказват заявки без разпознаваем User-Agent.
const UA = "ConsultPlus360/1.0 (+https://cplus360.com)"
const FETCH_TIMEOUT_MS = 15_000

async function getText(url: string): Promise<{ body: string; contentType: string; finalUrl: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8" },
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return {
      body: await r.text(),
      contentType: (r.headers.get("content-type") ?? "").toLowerCase(),
      finalUrl: r.url || url,
    }
  } finally {
    clearTimeout(timer)
  }
}

// ============================================================
// Дребни помощни за XML/HTML
// ============================================================

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    // &amp; НАКРАЯ — иначе „&amp;lt;" би станало „<" вместо „&lt;".
    .replace(/&amp;/g, "&")
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
}

/** Съдържанието на първия <tag>…</tag> в парчето. */
function tagText(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"))
  return m ? decodeEntities(m[1]).trim() : ""
}

function attr(tagStr: string, name: string): string {
  const m = tagStr.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"))
  return m ? m[1] : ""
}

function absolute(href: string, base: string): string {
  try {
    return new URL(href, base).toString()
  } catch {
    return href
  }
}

// ============================================================
// Откриване на феед
// ============================================================

function looksLikeFeed(body: string, contentType: string): boolean {
  if (/(rss|atom)\+xml|text\/xml|application\/xml/.test(contentType)) return true
  const head = body.slice(0, 2000)
  return /<rss[\s>]/i.test(head) || /<feed[\s>]/i.test(head) || /<rdf:RDF[\s>]/i.test(head)
}

/** <link rel="alternate" type="application/rss+xml" href="…"> в HTML-а. */
function findFeedLink(html: string, base: string): string | null {
  const links = html.match(/<link\b[^>]*>/gi) ?? []
  for (const l of links) {
    const type = attr(l, "type").toLowerCase()
    if (!/(rss|atom)\+xml/.test(type)) continue
    const href = attr(l, "href")
    if (href) return absolute(href, base)
  }
  return null
}

/** Ако сайтът не обявява феед, пробваме обичайните адреси. */
const GUESSES = ["rss", "feed", "feed/", "rss.xml", "feed.xml", "index.xml", "rss.php", "?feed=rss2"]

/**
 * Списък с адреси за пробване — И спрямо подадената пътека, И спрямо
 * КОРЕНА на домейна.
 *
 * Коренът е важният: повечето сайтове държат фееда си там
 * (kik-info.com/rss), а човек подава адреса на раздела, който чете
 * (kik-info.com/novini/nap/). Търсене само спрямо пътеката пропуска
 * точно най-честия случай.
 */
function guessUrls(finalUrl: string): string[] {
  const out: string[] = []
  const withSlash = finalUrl.endsWith("/") ? finalUrl : finalUrl + "/"
  let origin = ""
  try {
    origin = new URL(finalUrl).origin + "/"
  } catch {
    origin = ""
  }
  for (const g of GUESSES) out.push(absolute(g, withSlash))
  if (origin) for (const g of GUESSES) out.push(absolute(g, origin))
  // Без повторения — пътеката и коренът съвпадат за начална страница.
  return [...new Set(out)]
}

async function resolveFeed(url: string): Promise<{ feedUrl: string; body: string }> {
  const first = await getText(url)
  if (looksLikeFeed(first.body, first.contentType)) {
    return { feedUrl: first.finalUrl, body: first.body }
  }
  const declared = findFeedLink(first.body, first.finalUrl)
  if (declared) {
    const f = await getText(declared)
    if (looksLikeFeed(f.body, f.contentType)) return { feedUrl: f.finalUrl, body: f.body }
  }
  for (const guess of guessUrls(first.finalUrl)) {
    try {
      const f = await getText(guess)
      if (looksLikeFeed(f.body, f.contentType)) return { feedUrl: f.finalUrl, body: f.body }
    } catch {
      // пробата се проваля тихо — това е гадаене, не грешка
    }
  }
  throw new Error("на този адрес няма RSS/Atom феед — нито обявен в страницата, нито на обичайните адреси (пробвани са и пътеката, и коренът на домейна)")
}

// ============================================================
// Разбор на феед
// ============================================================

export interface FeedItem {
  title: string
  link: string
  summary: string
  published: string | null   // ISO
}

function parseDate(raw: string): string | null {
  if (!raw) return null
  const t = Date.parse(raw.trim())
  return isNaN(t) ? null : new Date(t).toISOString()
}

function parseFeed(xml: string, base: string): FeedItem[] {
  const isAtom = /<feed[\s>]/i.test(xml.slice(0, 2000))
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) ?? []
  const out: FeedItem[] = []

  for (const b of blocks) {
    const title = stripTags(tagText(b, "title"))
    let link = ""
    if (isAtom) {
      // Atom: линкът е в атрибут. Предпочита се rel="alternate".
      const links = b.match(/<link\b[^>]*>/gi) ?? []
      const alt = links.find(l => (attr(l, "rel") || "alternate").toLowerCase() === "alternate") ?? links[0]
      if (alt) link = attr(alt, "href")
    } else {
      link = tagText(b, "link")
      if (!link) link = tagText(b, "guid")
    }
    link = link ? absolute(link.trim(), base) : ""

    const summaryRaw = isAtom
      ? (tagText(b, "summary") || tagText(b, "content"))
      : (tagText(b, "description") || tagText(b, "content:encoded"))
    const summary = stripTags(summaryRaw)

    const published = parseDate(
      isAtom
        ? (tagText(b, "published") || tagText(b, "updated"))
        : (tagText(b, "pubDate") || tagText(b, "dc:date")),
    )

    if (!title || !link) continue
    out.push({ title, link, summary, published })
  }

  // Най-новите отгоре; феедовете обикновено вече са така, но не винаги.
  out.sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""))
  return out
}

const MAX_TITLE = 300
const MAX_SUMMARY = 500

function clip(s: string, n: number): string {
  const t = s.trim()
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "…"
}

// ============================================================
// HTTP
// ============================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const db = createClient(supabaseUrl, serviceKey)

    const raw = await req.text()
    const payload = raw ? JSON.parse(raw) : {}
    const action = payload.action ?? "run"

    // ---------- Самоличност ----------
    const cronSecret = Deno.env.get("NOTIFY_CRON_SECRET")
    const givenSecret = req.headers.get("x-cron-secret")
    const viaCron = !!cronSecret && !!givenSecret && givenSecret === cronSecret

    if (!viaCron) {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
      if (!token) return json({ error: "Липсва Authorization" }, 401)
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
      const { data: userData, error: userErr } = await userClient.auth.getUser(token)
      if (userErr || !userData.user) return json({ error: "Невалиден токен" }, 401)
      // Правата се проверяват от САМАТА RLS, а не с отделно повикване на
      // helper функциите: техните EXECUTE права вече веднъж счупиха четене
      // (урокът от миграция 050). Редът с настройките е точно един и
      // политиката му е admin-или-Управление → върне ли се, човекът има
      // право; не се ли върне, няма.
      const { data: allowedRow } = await userClient
        .from("crm_news_settings").select("id").eq("id", true).maybeSingle()
      if (!allowedRow) return json({ error: "Няма достъп" }, 403)
    }

    // ---------- action: check ----------
    if (action === "check") {
      const url = String(payload.url ?? "").trim()
      if (!url) return json({ error: "url е задължителен" }, 400)
      try {
        const { feedUrl, body } = await resolveFeed(url)
        const items = parseFeed(body, feedUrl)
        return json({
          ok: true,
          feed_url: feedUrl,
          count: items.length,
          latest: items.slice(0, 3).map(i => ({ title: i.title, link: i.link, published: i.published })),
        })
      } catch (e) {
        return json({ ok: false, error: (e as Error).message })
      }
    }

    if (action !== "run") return json({ error: "невалиден action (run / check)" }, 400)

    // ---------- action: run ----------
    const dryRun = payload.dry_run === true

    const { data: settingsRow, error: setErr } = await db
      .from("crm_news_settings").select("*").eq("id", true).single()
    if (setErr) return json({ error: `настройки: ${setErr.message}` }, 500)
    const settings = settingsRow as { enabled: boolean; max_per_run: number }

    if (!settings.enabled && !dryRun) {
      return json({ skipped: "новините от бранша са изключени от настройките", added: 0 })
    }

    const { data: srcData, error: srcErr } = await db
      .from("crm_news_sources").select("*").eq("enabled", true).order("position", { ascending: true })
    if (srcErr) return json({ error: `извори: ${srcErr.message}` }, 500)
    const sources = (srcData ?? []) as Array<{
      id: string; name: string; url: string; feed_url: string | null; max_per_run: number
    }>

    const candidates: Array<FeedItem & { source_id: string; source_name: string }> = []
    const notes: string[] = []

    for (const s of sources) {
      try {
        const { feedUrl, body } = await resolveFeed(s.feed_url || s.url)
        const items = parseFeed(body, feedUrl)
        if (items.length === 0) throw new Error("феедът е празен")

        // Диагностиката се пише винаги — „от N дни нищо оттук" е сигнал
        // за счупен извор, а не мълчание.
        if (!dryRun) {
          await db.from("crm_news_sources").update({
            feed_url: feedUrl,
            last_ok_at: new Date().toISOString(),
            last_item_at: items[0].published,
            last_error: null,
            updated_at: new Date().toISOString(),
          }).eq("id", s.id)
        }

        for (const it of items.slice(0, Math.max(1, s.max_per_run))) {
          candidates.push({ ...it, source_id: s.id, source_name: s.name })
        }
      } catch (e) {
        const msg = (e as Error).message
        notes.push(`${s.name}: ${msg}`)
        if (!dryRun) {
          await db.from("crm_news_sources")
            .update({ last_error: msg, updated_at: new Date().toISOString() })
            .eq("id", s.id)
        }
      }
    }

    if (candidates.length === 0) {
      return json({ added: 0, notes, drafts: [] })
    }

    // Вече публикуваните отпадат ПРЕДИ вмъкването — уникалният индекс
    // така или иначе пази, но без това всяко пускане би хвърляло грешки.
    const links = candidates.map(c => c.link)
    const { data: existing } = await db
      .from("crm_news").select("source_url").in("source_url", links)
    const seen = new Set(((existing ?? []) as Array<{ source_url: string }>).map(r => r.source_url))

    const fresh = candidates
      .filter(c => !seen.has(c.link))
      .sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""))
      .slice(0, Math.max(1, settings.max_per_run))

    const drafts = fresh.map(f => ({
      title: clip(f.title, MAX_TITLE),
      body: f.summary ? clip(f.summary, MAX_SUMMARY) : null,
      type: "general",
      is_auto: true,
      source_name: f.source_name,
      source_url: f.link,
      author_name: f.source_name,
    }))

    if (dryRun) return json({ dry_run: true, enabled: settings.enabled, notes, drafts })
    if (drafts.length === 0) return json({ added: 0, notes, drafts: [] })

    const { error: insErr } = await db.from("crm_news").insert(drafts)
    if (insErr) return json({ error: `вмъкване: ${insErr.message}`, notes }, 500)

    return json({ added: drafts.length, notes, drafts })
  } catch (err) {
    return json({ error: (err as Error).message ?? "Неочаквана грешка" }, 500)
  }
})
