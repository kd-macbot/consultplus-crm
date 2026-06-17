// Supabase Edge Function: swift-task (търси фирма по име/ЕИК в regdata.apis.bg).
// Историческо име на кода е „fetch-eik", но slug-ът (и папката) е „swift-task" —
// фронтендът вика именно него (src/lib/storage.ts → invoke('swift-task')).
//
// Deploy:
//   supabase functions deploy swift-task
//   supabase secrets set REGDATA_USERNAME=... REGDATA_PASSWORD=... REGDATA_PACKET_ID=1
//
// Frontend извикване:
//   POST /functions/v1/swift-task
//   body: { name: "АВОМИС ЕООД" }
//   → { eik, caption, candidates?: [...] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const API_BASE = "https://regdata.apis.bg/api/v1"
// TextSearch sub-type IDs (от GET /data/nom/22):
//   a9d4070f = Навсякъде, d5cf10b9 = Заглавие, dfbc200 = Предмет на дейност,
//   4fa0dc32 = Собственици, 185b135c = Управляващи
const TEXT_SUBTYPE_TITLE = "d5cf10b9"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

interface TokenRow {
  access_token: string
  refresh_token: string | null
  expires_at: string
}

async function getToken(sb: ReturnType<typeof createClient>): Promise<string> {
  const { data } = await sb
    .from("crm_regdata_token")
    .select("access_token, refresh_token, expires_at")
    .eq("id", 1)
    .maybeSingle<TokenRow>()

  // Валиден кеширан токен (с 60s буфер)
  if (data && new Date(data.expires_at).getTime() - 60_000 > Date.now()) {
    return data.access_token
  }

  // Опит за refresh
  if (data?.refresh_token) {
    const refreshed = await tryAuth({ refreshToken: data.refresh_token })
    if (refreshed) {
      await saveToken(sb, refreshed)
      return refreshed.accessToken
    }
  }

  // Пълна авторизация с потребител/парола
  const username = Deno.env.get("REGDATA_USERNAME")
  const password = Deno.env.get("REGDATA_PASSWORD")
  if (!username || !password) {
    throw new Error("REGDATA_USERNAME / REGDATA_PASSWORD не са настроени")
  }
  const fresh = await tryAuth({ username, password })
  if (!fresh) throw new Error("regdata: неуспешна авторизация")
  await saveToken(sb, fresh)
  return fresh.accessToken
}

async function tryAuth(body: object): Promise<
  { accessToken: string; refreshToken: string; expireSeconds: string } | null
> {
  const r = await fetch(`${API_BASE}/account/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  })
  if (!r.ok) return null
  return await r.json()
}

async function saveToken(
  sb: ReturnType<typeof createClient>,
  t: { accessToken: string; refreshToken: string; expireSeconds: string },
) {
  const expires = new Date(Date.now() + parseInt(t.expireSeconds, 10) * 1000).toISOString()
  await sb.from("crm_regdata_token").upsert({
    id: 1,
    access_token: t.accessToken,
    refresh_token: t.refreshToken,
    expires_at: expires,
    updated_at: new Date().toISOString(),
  })
}

function cleanName(name: string): string {
  // Премахваме често срещани правни форми и излишни интервали
  return name
    .replace(/\s+/g, " ")
    .replace(/\b(ЕООД|ООД|АД|ЕАД|СД|ЕТ|КД|КДА)\b/gi, "")
    .trim()
}

async function searchByName(token: string, name: string, subType: string) {
  // TextSearch: value е stringified JSON със searchText + searchFields (ID от nom/22)
  const body = {
    condition: "AND",
    rules: [
      {
        id: "TextSearch",
        operator: "in",
        value: [JSON.stringify({ searchText: cleanName(name), searchFields: [subType] })],
      },
    ],
  }
  const r = await fetch(`${API_BASE}/data/search2/1/10`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`regdata search ${r.status}: ${text}`)
  }
  return await r.json() as {
    totalCount: string
    currentCount: string
    results: Array<{ identifier: string; caption: string; activity: number }>
  }
}

async function getNomenclature(token: string, nomType: number) {
  const r = await fetch(`${API_BASE}/data/nom/${nomType}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`regdata nom/${nomType} ${r.status}: ${text}`)
  }
  return await r.json()
}

async function fetchData(token: string, eik: string, packetId: number) {
  const r = await fetch(`${API_BASE}/data/fetch/${packetId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify([{ ident: eik }]),
  })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`regdata fetch ${r.status}: ${text}`)
  }
  return await r.json()
}

interface RegDataAddress {
  settlement?: string
  street?: string
  streetNumber?: string
  block?: string
  entrance?: string
  floor?: string
  apartment?: string
}

function formatAddress(a?: RegDataAddress | null): string | null {
  if (!a) return null
  const parts: string[] = []
  if (a.settlement) parts.push(a.settlement)
  if (a.street) {
    const streetPart = [a.street, a.streetNumber].filter(Boolean).join(" ")
    if (streetPart) parts.push(streetPart)
  }
  const extras: string[] = []
  if (a.block) extras.push(`бл. ${a.block}`)
  if (a.entrance) extras.push(`вх. ${a.entrance}`)
  if (a.floor) extras.push(`ет. ${a.floor}`)
  if (a.apartment) extras.push(`ап. ${a.apartment}`)
  if (extras.length) parts.push(extras.join(", "))
  return parts.length ? parts.join(", ") : null
}

interface ParsedCompany {
  eik: string | null
  vat_number: string | null
  vat_registered_at: string | null
  address: string | null
  owner_name: string | null
  manager_name: string | null
  public_url: string | null
  // Дали regdata изобщо върна ДДС обект. Ако НЕ (нова фирма, чийто ДДС
  // запис още не е синхронизиран в регистъра) → правим VIES fallback.
  vat_data_present: boolean
}

// VIES (EU ДДС регистър) — fallback за нови фирми, които regdata още не е
// синхронизирал. Връща true (валиден ДДС номер), false (невалиден) или
// null (VIES недостъпен/грешка → не променяме нищо).
async function checkVies(eik: string): Promise<boolean | null> {
  try {
    const r = await fetch(
      `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/BG/vat/${encodeURIComponent(eik)}`,
      { headers: { Accept: "application/json" } },
    )
    if (!r.ok) return null
    const data = await r.json() as { isValid?: boolean; valid?: boolean; userError?: string }
    // userError „VALID"/„INVALID" или isValid/valid булеви — поддържаме и трите форми.
    if (typeof data.isValid === "boolean") return data.isValid
    if (typeof data.valid === "boolean") return data.valid
    if (data.userError === "VALID") return true
    if (data.userError === "INVALID") return false
    return null
  } catch {
    return null
  }
}

function parseDetails(d: any): ParsedCompany {
  const eik: string | null = d?.identifier ?? null
  const states: Array<{ date?: string; code?: string }> = Array.isArray(d?.vat?.states) ? d.vat.states : []
  // Сортираме по дата ascending → последния запис е актуалното състояние
  const sortedStates = [...states].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))

  // ДДС state кодове от регистъра (regdata), пълен списък от документацията.
  // Чифт логика: всеки „Дата на РЕГИСТРАЦИЯ" код влиза в REGISTER,
  // всеки „Дата на ДЕРЕГИСТРАЦИЯ" — в DEREGISTER.
  //   чл.96 (D14,D26,D28), чл.97 (D16), чл.97а (D6), чл.97б (D8),
  //   чл.98 (D18), чл.99 (D10,D30,D32), чл.100 (D12,D20,D22),
  //   чл.156 OSS (D34,D36), друго основание (D1,D24).
  const VAT_REGISTER_CODES = new Set([
    "D1", "D6", "D8", "D10", "D12", "D14", "D16", "D18", "D20",
    "D22", "D24", "D26", "D28", "D30", "D32", "D34", "D36",
  ])
  const VAT_DEREGISTER_CODES = new Set([
    "D2", "D7", "D9", "D11", "D13", "D15", "D17", "D19", "D21",
    "D23", "D25", "D27", "D29", "D31", "D33", "D35", "D37",
  ])
  // чл.151а (касова отчетност, D3/D4/D5) е ПОД-режим — не променя базовия ДДС
  // статус (фирмата вече е регистрирана). Игнорираме тези събития.
  const VAT_NEUTRAL_CODES = new Set(["D3", "D4", "D5"])

  // Актуалният статус се определя от ПОСЛЕДНОТО релевантно (не-неутрално) събитие.
  const relevant = sortedStates.filter((s) => !VAT_NEUTRAL_CODES.has(s.code ?? ""))
  const lastCode = relevant[relevant.length - 1]?.code ?? ""
  let vatActive: boolean
  if (VAT_DEREGISTER_CODES.has(lastCode)) vatActive = false
  else if (VAT_REGISTER_CODES.has(lastCode)) vatActive = true
  else vatActive = relevant.length > 0 // непознат код → консервативно: има събитие = активна

  const vat_number = vatActive && eik ? `BG${eik}` : null

  // Дата на регистрация: датата на ПОСЛЕДНОТО регистрационно събитие
  // (при повторна регистрация е по-точно); fallback — първото състояние.
  let vat_registered_at: string | null = null
  if (vatActive) {
    const lastReg = [...relevant].reverse().find((s) => VAT_REGISTER_CODES.has(s.code ?? ""))
    const regDate = lastReg?.date ?? sortedStates[0]?.date
    vat_registered_at = regDate ? regDate.split("T")[0] : null
  }

  const address = formatAddress(d?.addresses?.[0] ?? d?.vat?.address) ?? null
  const owner_name = d?.owners?.[0]?.name ?? null
  const managers: string[] = (d?.managers ?? []).map((m: any) => m?.name).filter(Boolean)
  const manager_name = managers.length ? managers.slice(0, 3).join(", ") : null
  const public_url: string | null = typeof d?.url === "string" ? d.url : null
  const vat_data_present = !!d?.vat
  return { eik, vat_number, vat_registered_at, address, owner_name, manager_name, public_url, vat_data_present }
}

// Ако regdata НЯМА ДДС данни (нова фирма), питаме VIES. Мутира fields на място.
async function applyViesFallback(fields: ParsedCompany): Promise<void> {
  if (fields.vat_number || fields.vat_data_present || !fields.eik) return
  const valid = await checkVies(fields.eik)
  if (valid === true) {
    fields.vat_number = `BG${fields.eik}`
    // VIES не дава дата на регистрация → оставяме null.
    fields.vat_registered_at = null
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    // Body може да дойде като application/json или text/plain (заобикаляне на CORS preflight)
    const rawBody = await req.text()
    const payload = rawBody ? JSON.parse(rawBody) : {}
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )
    const token = await getToken(sb)
    const packetId = parseInt(Deno.env.get("REGDATA_PACKET_ID") || "1", 10)

    // Диагностичен режим — върни съдържанието на nomenclature
    if (payload.diagnose) {
      const nomType = typeof payload.diagnose === "number" ? payload.diagnose : 22
      return json({ nomType, items: await getNomenclature(token, nomType) })
    }

    // Диагностичен режим — върни суровия отговор от data/fetch за даден EIK
    if (payload.fetchEik) {
      return json({ raw: await fetchData(token, payload.fetchEik, packetId) })
    }

    // Bypass на search-а: ако клиентът вече знае ЕИК, директно вземаме full data
    if (payload.eik && typeof payload.eik === "string") {
      try {
        const fetched = await fetchData(token, payload.eik, packetId)
        const details = Array.isArray(fetched) ? fetched[0] : fetched
        if (!details || !details.identifier) {
          return json({ eik: null, caption: null, total: 0, candidates: [], fields: null, error: `ЕИК ${payload.eik} не е намерен в регистъра` })
        }
        const fields = parseDetails(details)
        await applyViesFallback(fields)
        return json({
          eik: payload.eik,
          caption: details?.name ? `${details.name}${details.legalFormShort ? " " + details.legalFormShort : ""}` : null,
          total: 1,
          candidates: [],
          fields,
        })
      } catch (e) {
        return json({ eik: null, caption: null, total: 0, candidates: [], fields: null, error: `Грешка при извличане на ЕИК ${payload.eik}: ${(e as Error).message}` })
      }
    }

    const { name, subType } = payload
    if (!name || typeof name !== "string") {
      return json({ error: "name is required" }, 400)
    }

    const search = await searchByName(token, name, subType || TEXT_SUBTYPE_TITLE)
    const active = search.results.filter((r) => r.activity === 1)
    const best = active[0] ?? search.results[0]

    // По подразбиране теглим и пълните данни от data/fetch — освен ако клиентът
    // изрично не каже enrich: false.
    let fields: ParsedCompany | null = null
    if (best?.identifier && payload.enrich !== false) {
      try {
        const fetched = await fetchData(token, best.identifier, packetId)
        const details = Array.isArray(fetched) ? fetched[0] : fetched
        fields = parseDetails(details)
        await applyViesFallback(fields)
      } catch {
        fields = { eik: best.identifier, vat_number: null, vat_registered_at: null, address: null, owner_name: null, manager_name: null, public_url: null, vat_data_present: false }
      }
    }

    return json({
      eik: best?.identifier ?? null,
      caption: best?.caption ?? null,
      total: parseInt(search.totalCount, 10),
      candidates: search.results.slice(0, 5),
      fields,
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}
