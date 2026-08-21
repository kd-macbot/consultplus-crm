// Supabase Edge Function: mail-send — известия по имейл до служителите.
//
// Един файл нарочно (deploy-ва се ръчно през Dashboard, както останалите).
//
// Deploy:
//   supabase functions deploy mail-send --no-verify-jwt
//   supabase secrets set RESEND_API_KEY=re_...
//   supabase secrets set MAIL_FROM="Consult Plus 360 <noreply@cplus360.com>"
//   supabase secrets set NOTIFY_CRON_SECRET=<дълъг случаен низ>
//   (по избор) supabase secrets set APP_URL=https://cplus360.com
//
// --no-verify-jwt + собствена проверка вътре — както admin-create-user.
// Две допустими самоличности:
//   • admin JWT (Authorization: Bearer <session token>) — от страницата
//     „Известия": ръчно писмо, пробно писмо, „Пусни сега".
//   • header x-cron-secret: <NOTIFY_CRON_SECRET> — от GitHub Action-а,
//     който пуска автоматичните напомняния. Само за action=run.
//
// Действия:
//   { action: "run", dry_run?: true }
//       → пресмята напомнянията и ги изпраща. dry_run само ги ВРЪЩА.
//   { action: "send", messages: [{ to, to_name?, subject, text, staff_id? }] }
//       → ръчно писмо (admin).
//   { action: "test", to?: "..." }
//       → пробно писмо (admin); без to се ползва test_email от настройките.
//
// ЛИЧНИ ДАННИ: писмата са до КОЛЕГИ и съдържат имена на фирми, заглавия
// на задачи и срокове. НЕ слагай тук ЕГН, лични карти, IBAN или хонорари —
// имейлът излиза извън системата и остава в лога на доставчика.

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

const APP_URL = Deno.env.get("APP_URL") ?? "https://cplus360.com"
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "Consult Plus 360 <noreply@cplus360.com>"

// ============================================================
// Дребни помощни
// ============================================================

const MONTH_NAMES = [
  "Януари", "Февруари", "Март", "Април", "Май", "Юни",
  "Юли", "Август", "Септември", "Октомври", "Ноември", "Декември",
]

const pad = (n: number) => String(n).padStart(2, "0")

/** Същата нормализация като namesMatch в src/lib/utils.ts. */
function normalizeName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().trim().replace(/\s+/g, " ")
}
function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeName(a)
  return na.length > 0 && na === normalizeName(b)
}

function isValidEmail(s: string | null | undefined): boolean {
  return !!s && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim())
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

/**
 * Днешната дата в СОФИЙСКО време. Cron-ът пуска по UTC — без това
 * напомняне, пуснато в 23:30 UTC, би паднало в „вчера".
 */
function sofiaToday(now = new Date()): { year: number; month: number; day: number; iso: string } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia", year: "numeric", month: "2-digit", day: "2-digit",
  })
  const [y, m, d] = f.format(now).split("-").map(Number)
  return { year: y, month: m, day: d, iso: `${y}-${pad(m)}-${pad(d)}` }
}

/** Разлика в ЦЕЛИ дни между две ISO дати (b − a). */
function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(`${aIso}T00:00:00Z`)
  const b = Date.parse(`${bIso}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/** ISO (YYYY-MM-DD) → „21.08.2026" */
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-")
  return `${d}.${m}.${y}`
}

/** Работният месец е ПРЕДХОДНИЯТ календарен. */
function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

/** „остават 3 дни" / „утре" / „днес" / „закъснение 2 дни" */
function dueLabel(diff: number): string {
  if (diff < 0) return `закъснение ${Math.abs(diff)} ${Math.abs(diff) === 1 ? "ден" : "дни"}`
  if (diff === 0) return "днес"
  if (diff === 1) return "утре"
  return `след ${diff} дни`
}

// ============================================================
// PostgREST реже отговора (Supabase: 1000 реда). Клетките са ~3000 —
// без страниране наборът излиза НЕПЪЛЕН, при това без нито една грешка.
//
// Стъпката е СПОРЕД върнатото, не според заявеното: ако сървърът е
// настроен на по-малко от PAGE, „получих по-малко → значи е краят" би
// спряло по средата. Затова се върти до празна страница.
// Заявките ЗАДЪЛЖИТЕЛНО са подредени по id — иначе страниците могат да
// се препокриват или да прескочат ред.
// ============================================================
async function fetchAll<T>(
  // deno-lint-ignore no-explicit-any
  build: (from: number, to: number) => any,
): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; ; ) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    if (rows.length === 0) break
    out.push(...rows)
    from += rows.length
  }
  return out
}

// ============================================================
// Resend
// ============================================================
async function sendMail(to: string, subject: string, text: string, html: string): Promise<string> {
  const key = Deno.env.get("RESEND_API_KEY")
  if (!key) throw new Error("RESEND_API_KEY не е настроен")
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, text, html }),
  })
  const body = await r.text()
  if (!r.ok) throw new Error(`Resend HTTP ${r.status}: ${body}`)
  try {
    return (JSON.parse(body) as { id?: string })?.id ?? ""
  } catch {
    return ""
  }
}

// ============================================================
// Оформление на писмото
// ============================================================
interface Section { title?: string; lines: string[] }

function buildText(greeting: string, intro: string, sections: Section[], linkLabel: string, linkUrl: string): string {
  const parts = [greeting, "", intro, ""]
  for (const s of sections) {
    if (s.lines.length === 0) continue
    if (s.title) parts.push(s.title.toUpperCase())
    for (const l of s.lines) parts.push(`• ${l}`)
    parts.push("")
  }
  parts.push(`${linkLabel}: ${linkUrl}`, "", "—", "Consult Plus 360 · автоматично съобщение")
  return parts.join("\n")
}

/**
 * Свободен текст (ръчно писмо): абзаци, както е написан. Булетите на
 * автоматичните напомняния тук биха изкривили смисъла.
 */
function buildFreeText(greeting: string, lines: string[], linkUrl: string): string {
  return [greeting, "", ...lines, "", `Системата: ${linkUrl}`, "", "—", "Consult Plus 360"].join("\n")
}

function buildFreeHtml(greeting: string, lines: string[], linkUrl: string): string {
  const body = lines
    .map(l => `<p style="margin:0 0 10px">${escapeHtml(l)}</p>`)
    .join("")
  return `<!doctype html><html lang="bg"><body style="margin:0;background:#f1f5f9;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;font:15px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a">
  <p style="margin:0 0 16px">${escapeHtml(greeting)}</p>
  ${body}
  <p style="margin:24px 0 0"><a href="${escapeHtml(linkUrl)}" style="display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Отвори системата</a></p>
  <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8">Consult Plus 360</p>
</div></body></html>`
}

function buildHtml(greeting: string, intro: string, sections: Section[], linkLabel: string, linkUrl: string): string {
  const blocks = sections
    .filter(s => s.lines.length > 0)
    .map(s => {
      const title = s.title
        ? `<p style="margin:20px 0 6px;font:600 12px/1.4 system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#64748b">${escapeHtml(s.title)}</p>`
        : ""
      const items = s.lines
        .map(l => `<li style="margin:0 0 6px">${escapeHtml(l)}</li>`)
        .join("")
      return `${title}<ul style="margin:0;padding-left:20px">${items}</ul>`
    })
    .join("")
  return `<!doctype html><html lang="bg"><body style="margin:0;background:#f1f5f9;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;font:15px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a">
  <p style="margin:0 0 16px">${escapeHtml(greeting)}</p>
  <p style="margin:0 0 4px">${escapeHtml(intro)}</p>
  ${blocks}
  <p style="margin:24px 0 0"><a href="${escapeHtml(linkUrl)}" style="display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${escapeHtml(linkLabel)}</a></p>
  <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8">Consult Plus 360 · автоматично съобщение. Ако не искаш повече такива писма, кажи на администратора.</p>
</div></body></html>`
}

// ============================================================
// Чернови
// ============================================================
interface Draft {
  kind: string
  staff_id: string | null
  to_email: string
  to_name: string
  subject: string
  text: string
  html: string
  dedupe_key: string | null
}

interface StaffRow {
  id: string
  full_name: string
  email: string | null
  department: string | null
  notify_email: boolean
}

interface Settings {
  enabled: boolean
  tasks_enabled: boolean
  tasks_days_before: number
  checklist_enabled: boolean
  checklist_days: number[]
  test_email: string | null
}

// deno-lint-ignore no-explicit-any
type Db = any

/** Само активните колеги с валиден имейл, които не са се отписали. */
function notifiable(staff: StaffRow[]): StaffRow[] {
  return staff.filter(s => s.notify_email !== false && isValidEmail(s.email))
}

/** Първото име — „Иван Петров Георгиев" → „Иван". */
function firstName(full: string): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? ""
}

const CHECKLIST_FIELDS = [
  "check_clients", "check_invoice_numbers", "check_missing_invoices", "spo", "check_income",
  "check_suppliers", "otmyata", "duplicate_invoices", "rko", "accounting_invoice",
  "regular_invoices_art82", "check_unfinished_docs",
] as const

// ---------- Задачи ----------
async function buildTaskDrafts(db: Db, settings: Settings, staff: StaffRow[], today: string): Promise<Draft[]> {
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + settings.tasks_days_before * 86_400_000)
  const horizonIso = horizon.toISOString().slice(0, 10)

  const { data: tasks, error } = await db
    .from("crm_tasks")
    .select("id,title,kind,status,due_date,assignee_staff_id,client_id")
    .in("status", ["todo", "in_progress", "issue"])
    .not("due_date", "is", null)
    .lte("due_date", horizonIso)
  if (error) throw new Error(`задачи: ${error.message}`)

  const rows = (tasks ?? []) as Array<{
    id: string; title: string; kind: string; status: string
    due_date: string; assignee_staff_id: string | null; client_id: string | null
  }>
  if (rows.length === 0) return []

  const byStaff = new Map<string, typeof rows>()
  for (const t of rows) {
    if (!t.assignee_staff_id) continue
    const list = byStaff.get(t.assignee_staff_id) ?? []
    list.push(t)
    byStaff.set(t.assignee_staff_id, list)
  }
  if (byStaff.size === 0) return []

  const names = await clientNames(db)
  const drafts: Draft[] = []

  for (const person of notifiable(staff)) {
    const mine = byStaff.get(person.id)
    if (!mine || mine.length === 0) continue

    mine.sort((a, b) => a.due_date.localeCompare(b.due_date))
    const overdue: string[] = []
    const soon: string[] = []
    for (const t of mine) {
      const diff = daysBetween(today, t.due_date)
      const client = t.client_id ? names.get(t.client_id) : null
      const label = `${t.title}${client ? ` (${client})` : ""}${t.kind === "inspection" ? " · проверка" : ""} — срок ${fmtDate(t.due_date)}, ${dueLabel(diff)}`
      ;(diff < 0 ? overdue : soon).push(label)
    }

    const subject = overdue.length > 0
      ? `Просрочени задачи: ${overdue.length}${soon.length > 0 ? ` (и ${soon.length} с наближаващ срок)` : ""}`
      : `Задачи с наближаващ срок: ${soon.length}`

    const intro = `Ето задачите ти със срок до ${settings.tasks_days_before} ${settings.tasks_days_before === 1 ? "ден" : "дни"} напред:`
    const sections: Section[] = [
      { title: "Просрочени", lines: overdue },
      { title: "Предстоящи", lines: soon },
    ]
    const greeting = `Здравей, ${firstName(person.full_name)},`
    const url = `${APP_URL}/#/tasks`

    drafts.push({
      kind: "task_due",
      staff_id: person.id,
      to_email: person.email!.trim(),
      to_name: person.full_name,
      subject,
      text: buildText(greeting, intro, sections, "Отвори Задачи", url),
      html: buildHtml(greeting, intro, sections, "Отвори Задачи", url),
      // Един обзор на човек на ден — независимо колко пъти се пусне cron-ът.
      dedupe_key: `task_due:${person.id}:${today}`,
    })
  }
  return drafts
}

// ---------- ДДС чек лист ----------
async function buildChecklistDrafts(db: Db, settings: Settings, staff: StaffRow[], today: { year: number; month: number; day: number; iso: string }): Promise<Draft[]> {
  const work = previousMonth(today.year, today.month)
  const deadline = `${today.year}-${pad(today.month)}-14`
  const left = daysBetween(today.iso, deadline)

  const [{ data: columnsData, error: colErr }, { data: dropdownData, error: ddErr }] = await Promise.all([
    db.from("crm_columns").select("id,name,type,position").order("position", { ascending: true }),
    db.from("crm_dropdown_options").select("id,value"),
  ])
  if (colErr) throw new Error(`колони: ${colErr.message}`)
  if (ddErr) throw new Error(`dropdown опции: ${ddErr.message}`)

  const columns = (columnsData ?? []) as Array<{ id: string; name: string; type: string; position: number }>
  const dropdowns = new Map<string, string>()
  for (const d of (dropdownData ?? []) as Array<{ id: string; value: string }>) dropdowns.set(d.id, d.value)

  const cells = await fetchAll<{ client_id: string; column_id: string; value_text: string | null; value_dropdown: string | null }>(
    (from, to) => db.from("crm_cell_values")
      .select("client_id,column_id,value_text,value_dropdown")
      .order("id", { ascending: true }).range(from, to),
  )
  const cellIdx = new Map<string, { value_text: string | null; value_dropdown: string | null }>()
  for (const c of cells) cellIdx.set(`${c.client_id}|${c.column_id}`, c)

  const colByName = new Map(columns.map(c => [c.name, c]))
  const textCols = columns.filter(c => c.type === "text")

  const value = (clientId: string, colId: string | undefined): string => {
    if (!colId) return ""
    const cell = cellIdx.get(`${clientId}|${colId}`)
    if (!cell) return ""
    if (cell.value_text) return cell.value_text
    if (cell.value_dropdown) return dropdowns.get(cell.value_dropdown) ?? ""
    return ""
  }

  const { data: clientsData, error: clErr } = await db.from("crm_clients").select("id")
  if (clErr) throw new Error(`клиенти: ${clErr.message}`)

  const { data: checklistData, error: chErr } = await db
    .from("crm_checklist")
    .select("*")
    .eq("year", work.year)
    .eq("month", work.month)
  if (chErr) throw new Error(`чек лист: ${chErr.message}`)
  // deno-lint-ignore no-explicit-any
  const checklist = new Map<string, any>()
  // deno-lint-ignore no-explicit-any
  for (const r of (checklistData ?? []) as any[]) checklist.set(r.client_id, r)

  const statusCol = colByName.get("Статус")
  const accountantCol = colByName.get("Счетоводител")
  const respCol = colByName.get("Отговорник")

  interface Firm { name: string; accountant: string; responsible: string; done: number }
  const firms: Firm[] = []
  for (const c of (clientsData ?? []) as Array<{ id: string }>) {
    const status = value(c.id, statusCol?.id).toLowerCase()
    // Същите изключения като в страницата „Личен чек лист".
    if (status.includes("без дейност") || status.includes("без ддс") || status.includes("нулево")) continue
    let name = ""
    for (const tc of textCols) {
      const v = cellIdx.get(`${c.id}|${tc.id}`)?.value_text
      if (v) { name = v; break }
    }
    const row = checklist.get(c.id)
    const done = row ? CHECKLIST_FIELDS.filter(f => row[f]).length : 0
    if (done === CHECKLIST_FIELDS.length) continue
    firms.push({
      name: name || "(без име)",
      accountant: value(c.id, accountantCol?.id),
      responsible: value(c.id, respCol?.id),
      done,
    })
  }
  if (firms.length === 0) return []

  const drafts: Draft[] = []
  for (const person of notifiable(staff)) {
    // Чек листът е скрит за ТРЗ отдела — няма смисъл да им пише.
    if (person.department === "ТРЗ") continue
    const mine = firms
      .filter(f => namesMatch(f.accountant, person.full_name) || namesMatch(f.responsible, person.full_name))
      .sort((a, b) => a.name.localeCompare(b.name, "bg"))
    if (mine.length === 0) continue

    const lines = mine.map(f => `${f.name} — ${f.done} от ${CHECKLIST_FIELDS.length} стъпки`)
    const greeting = `Здравей, ${firstName(person.full_name)},`
    const intro = `Срокът за ДДС за ${MONTH_NAMES[work.month - 1]} ${work.year} е ${fmtDate(deadline)} (${dueLabel(left)}). Незавършен чек лист имат ${mine.length} ${mine.length === 1 ? "фирма" : "фирми"}:`
    const url = `${APP_URL}/#/checklist`

    drafts.push({
      kind: "checklist_dds",
      staff_id: person.id,
      to_email: person.email!.trim(),
      to_name: person.full_name,
      subject: `ДДС до ${fmtDate(deadline)}: ${mine.length} незавършени в чек листа`,
      text: buildText(greeting, intro, [{ lines }], "Отвори Чек лист", url),
      html: buildHtml(greeting, intro, [{ lines }], "Отвори Чек лист", url),
      dedupe_key: `checklist_dds:${person.id}:${work.year}-${pad(work.month)}:${today.iso}`,
    })
  }
  return drafts
}

/** client_id → име (първата text колона по позиция). */
async function clientNames(db: Db): Promise<Map<string, string>> {
  const { data: cols, error } = await db
    .from("crm_columns").select("id,type,position").eq("type", "text").order("position", { ascending: true })
  if (error) throw new Error(`колони: ${error.message}`)
  const ordered = (cols ?? []) as Array<{ id: string; position: number }>
  if (ordered.length === 0) return new Map()
  const ids = ordered.map(c => c.id)
  const cells = await fetchAll<{ client_id: string; column_id: string; value_text: string | null }>(
    (from, to) => db.from("crm_cell_values")
      .select("client_id,column_id,value_text").in("column_id", ids)
      .order("id", { ascending: true }).range(from, to),
  )
  const rank = new Map(ordered.map((c, i) => [c.id, i]))
  const best = new Map<string, { rank: number; name: string }>()
  for (const c of cells) {
    if (!c.value_text) continue
    const r = rank.get(c.column_id) ?? 999
    const cur = best.get(c.client_id)
    if (!cur || r < cur.rank) best.set(c.client_id, { rank: r, name: c.value_text })
  }
  return new Map([...best].map(([id, v]) => [id, v.name]))
}

// ============================================================
// Изпращане + дневник
// ============================================================
interface DeliverResult {
  to: string
  kind: string
  subject: string
  status: "sent" | "error" | "skipped"
  error?: string
}

async function deliver(db: Db, drafts: Draft[], createdBy: string | null): Promise<DeliverResult[]> {
  const results: DeliverResult[] = []
  for (const d of drafts) {
    // 1) Заявка в дневника ПРЕДИ изпращането. Уникалният индекс върху
    //    dedupe_key е това, което пази от двойно писмо при повторен cron.
    const { data: claimed, error: claimErr } = await db
      .from("crm_notifications")
      .insert({
        kind: d.kind, to_email: d.to_email, to_name: d.to_name, staff_id: d.staff_id,
        subject: d.subject, body: d.text, status: "pending",
        dedupe_key: d.dedupe_key, created_by: createdBy,
      })
      .select("id")
      .single()

    if (claimErr) {
      // 23505 = уникален конфликт → вече е пращано, тихо прескачаме.
      if ((claimErr as { code?: string }).code === "23505") {
        results.push({ to: d.to_email, kind: d.kind, subject: d.subject, status: "skipped" })
        continue
      }
      results.push({ to: d.to_email, kind: d.kind, subject: d.subject, status: "error", error: claimErr.message })
      continue
    }

    // 2) Изпращане.
    try {
      const providerId = await sendMail(d.to_email, d.subject, d.text, d.html)
      await db.from("crm_notifications")
        .update({ status: "sent", provider_id: providerId })
        .eq("id", claimed.id)
      results.push({ to: d.to_email, kind: d.kind, subject: d.subject, status: "sent" })
    } catch (e) {
      // Провалът НЕ бива да заключи ключа — иначе следващото пускане
      // ще го сметне за „вече изпратено" и писмото никога няма да тръгне.
      await db.from("crm_notifications")
        .update({ status: "error", error: (e as Error).message, dedupe_key: null })
        .eq("id", claimed.id)
      results.push({ to: d.to_email, kind: d.kind, subject: d.subject, status: "error", error: (e as Error).message })
    }
  }
  return results
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

    let callerId: string | null = null
    if (!viaCron) {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
      if (!token) return json({ error: "Липсва Authorization" }, 401)
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
      const { data: userData, error: userErr } = await userClient.auth.getUser(token)
      if (userErr || !userData.user) return json({ error: "Невалиден токен" }, 401)
      const { data: caller } = await db
        .from("profiles").select("role,is_active").eq("id", userData.user.id).single()
      if (!caller || caller.role !== "admin" || caller.is_active === false) {
        return json({ error: "Само администратор може да праща известия" }, 403)
      }
      callerId = userData.user.id
    }

    // ---------- Настройки ----------
    const { data: settingsRow, error: setErr } = await db
      .from("crm_notification_settings").select("*").eq("id", true).single()
    if (setErr) return json({ error: `настройки: ${setErr.message}` }, 500)
    const settings = settingsRow as Settings

    // ---------- action: test ----------
    if (action === "test") {
      const to = (payload.to ?? settings.test_email ?? "").trim()
      if (!isValidEmail(to)) return json({ error: "Няма валиден адрес за пробното писмо" }, 400)
      const greeting = "Здравей,"
      const intro = "Това е пробно писмо от Consult Plus 360. Ако си го получил, известията работят."
      const sections: Section[] = [{ lines: [`Изпратено на ${fmtDate(sofiaToday().iso)}`] }]
      const draft: Draft = {
        kind: "test", staff_id: null, to_email: to, to_name: "",
        subject: "Пробно писмо — Consult Plus 360",
        text: buildText(greeting, intro, sections, "Отвори системата", APP_URL),
        html: buildHtml(greeting, intro, sections, "Отвори системата", APP_URL),
        dedupe_key: null,
      }
      return json({ results: await deliver(db, [draft], callerId) })
    }

    // ---------- action: send (ръчно) ----------
    if (action === "send") {
      const messages = Array.isArray(payload.messages) ? payload.messages : []
      if (messages.length === 0) return json({ error: "messages е празен" }, 400)
      if (messages.length > 50) return json({ error: "максимум 50 писма на заявка" }, 400)

      const drafts: Draft[] = []
      for (const m of messages) {
        if (!isValidEmail(m.to)) return json({ error: `невалиден адрес: ${m.to}` }, 400)
        if (!m.subject || !m.text) return json({ error: "всяко писмо иска subject и text" }, 400)
        const greeting = m.to_name ? `Здравей, ${firstName(m.to_name)},` : "Здравей,"
        const lines = String(m.text).split("\n").map((l: string) => l.trim()).filter(Boolean)
        drafts.push({
          kind: "manual", staff_id: m.staff_id ?? null,
          to_email: String(m.to).trim(), to_name: m.to_name ?? "",
          subject: String(m.subject),
          text: buildFreeText(greeting, lines, APP_URL),
          html: buildFreeHtml(greeting, lines, APP_URL),
          dedupe_key: null,
        })
      }
      return json({ results: await deliver(db, drafts, callerId) })
    }

    // ---------- action: run (напомнянията) ----------
    if (action !== "run") return json({ error: "невалиден action (run / send / test)" }, 400)

    const dryRun = payload.dry_run === true
    const today = sofiaToday()

    if (!settings.enabled && !dryRun) {
      return json({ skipped: "известията са изключени от настройките", results: [] })
    }

    const { data: staffData, error: staffErr } = await db
      .from("crm_staff").select("id,full_name,email,department,notify_email").eq("is_active", true)
    if (staffErr) return json({ error: `персонал: ${staffErr.message}` }, 500)
    const staff = (staffData ?? []) as StaffRow[]

    const drafts: Draft[] = []
    const reasons: string[] = []

    if (settings.tasks_enabled) {
      drafts.push(...await buildTaskDrafts(db, settings, staff, today.iso))
    } else {
      reasons.push("напомнянето за задачи е изключено")
    }

    if (settings.checklist_enabled) {
      // Само на избраните дати — иначе всеки ден щеше да идва писмо.
      if ((settings.checklist_days ?? []).includes(today.day)) {
        drafts.push(...await buildChecklistDrafts(db, settings, staff, today))
      } else {
        reasons.push(`днес (${today.day}-то) не е дата за напомняне за чек листа`)
      }
    } else {
      reasons.push("напомнянето за чек листа е изключено")
    }

    if (dryRun) {
      return json({
        dry_run: true,
        enabled: settings.enabled,
        date: today.iso,
        notes: reasons,
        drafts: drafts.map(d => ({ kind: d.kind, to: d.to_email, to_name: d.to_name, subject: d.subject, text: d.text })),
      })
    }

    const results = await deliver(db, drafts, callerId)
    return json({
      date: today.iso,
      notes: reasons,
      sent: results.filter(r => r.status === "sent").length,
      skipped: results.filter(r => r.status === "skipped").length,
      errors: results.filter(r => r.status === "error").length,
      results,
    })
  } catch (err) {
    return json({ error: (err as Error).message ?? "Неочаквана грешка" }, 500)
  }
})
