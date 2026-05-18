// Supabase Edge Function: fetch-eik
// Търси фирма по име в regdata.apis.bg и връща ЕИК + основни данни.
//
// Deploy:
//   supabase functions deploy fetch-eik
//   supabase secrets set REGDATA_USERNAME=... REGDATA_PASSWORD=... REGDATA_PACKET_ID=1
//
// Frontend извикване:
//   POST /functions/v1/fetch-eik
//   body: { name: "АВОМИС ЕООД" }
//   → { eik, caption, candidates?: [...] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const API_BASE = "https://regdata.apis.bg/api/v1"

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
  // TextSearch очаква JSON-сериализиран обект със subType (от nom/22)
  const body = {
    condition: "AND",
    rules: [
      {
        id: "TextSearch",
        operator: "in",
        value: [JSON.stringify({ text: cleanName(name), type: subType })],
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const payload = await req.json()
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )
    const token = await getToken(sb)

    // Диагностичен режим — върни съдържанието на nomenclature
    if (payload.diagnose) {
      const nomType = typeof payload.diagnose === "number" ? payload.diagnose : 22
      return json({ nomType, items: await getNomenclature(token, nomType) })
    }

    const { name, subType } = payload
    if (!name || typeof name !== "string") {
      return json({ error: "name is required" }, 400)
    }
    if (!subType || typeof subType !== "string") {
      return json({ error: "subType is required (use {diagnose: 22} to list TextSearch sub-types)" }, 400)
    }

    const search = await searchByName(token, name, subType)
    const active = search.results.filter((r) => r.activity === 1)
    const best = active[0] ?? search.results[0]

    return json({
      eik: best?.identifier ?? null,
      caption: best?.caption ?? null,
      total: parseInt(search.totalCount, 10),
      candidates: search.results.slice(0, 5),
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
