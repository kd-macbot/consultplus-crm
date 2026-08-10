// Supabase Edge Function: mobica-send (изпращане на съобщения към клиенти
// през Mobica — Viber с автоматичен SMS fallback, DLR статуси, баланс).
//
// Deploy (ръчно през Dashboard, както swift-task):
//   supabase functions deploy mobica-send
//   supabase secrets set MOBICA_USER=... MOBICA_PASS=...
//
// Frontend извикване (src/lib/storage.ts → invoke('mobica-send')):
//   { action: "send", messages: [{ idd, phone, text, sms_text?, tag? }] }
//     → { code, description }   (1004 = прието)
//   { action: "dlr", reference_ids: ["idd1", ...] }
//     → { idd1: [{ channel, code, description, date_report, ... }], ... }
//   { action: "balance" }
//     → { username, amount, currency }
//
// Документация: https://mobica.bg/bg/docs/v2/api-application-programming-interface
//   POST https://gate.mobica.bg/v2/multi/json/viber.php
//   POST https://gate.mobica.bg/v2/multi/json/dlr_reference_id.php
//   POST https://gate.mobica.bg/v2/user/account_balance.php

const GATE = "https://gate.mobica.bg/v2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

interface SendMessage {
  idd: string
  phone: string
  text: string
  sms_text?: string
  tag?: string
  validity_period_sec?: number
}

function creds(): { user: string; pass: string } {
  const user = Deno.env.get("MOBICA_USER")
  const pass = Deno.env.get("MOBICA_PASS")
  if (!user || !pass) throw new Error("MOBICA_USER / MOBICA_PASS не са настроени")
  return { user, pass }
}

async function mobicaPost(path: string, body: object): Promise<unknown> {
  const r = await fetch(`${GATE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`mobica ${path} HTTP ${r.status}: ${text}`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`mobica ${path}: невалиден JSON отговор: ${text}`)
  }
}

// Кодове, при които заявката НЕ е приета (Table 4) — връщаме ги като грешка
// с човешко описание, за да не пишем "accepted" в дневника.
const REJECT_DESCRIPTIONS: Record<string, string> = {
  "1005": "Отхвърлена заявка",
  "1006": "Невалиден телефонен номер",
  "1008": "Невалиден формат на заявката",
  "1115": "Грешно потребителско име или парола",
  "1117": "Недостатъчна наличност в Mobica акаунта",
  "1118": "Твърде много заявки (flood)",
  "1119": "Каналът не е разрешен за акаунта",
  "1120": "Липсва задължително поле",
  "1121": "Заявка от неразрешен IP адрес",
  "1122": "Акаунтът не е активен",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const { user, pass } = creds()

    // ---------- Изпращане (Viber + SMS fallback в една заявка) ----------
    if (payload.action === "send") {
      const messages: SendMessage[] = Array.isArray(payload.messages) ? payload.messages : []
      if (messages.length === 0) return json({ error: "messages е празен" }, 400)
      if (messages.length > 100) return json({ error: "максимум 100 съобщения на заявка" }, 400)

      for (const m of messages) {
        if (!m.idd || !m.phone || !m.text) {
          return json({ error: "всяко съобщение изисква idd, phone и text" }, 400)
        }
        if (!/^359\d{8,9}$/.test(m.phone)) {
          return json({ error: `невалиден номер: ${m.phone} (очаква се 359XXXXXXXXX)` }, 400)
        }
      }

      const body = {
        user,
        pass,
        viber: messages.map((m) => ({
          idd: m.idd,
          tag: m.tag ?? "cplus360",
          phone: m.phone,
          text: m.text,
          image_url: "",
          button_url: "",
          button_text: "",
          // Текст без бутон/картинка = transactional (Table 3)
          is_promotional: 0,
          // Прозорец за Viber доставка, после SMS fallback. Кратък (60s),
          // за да падне бързо на SMS, докато няма одобрен Viber sender —
          // иначе съобщението виси в опит за Viber до изтичане на прозореца.
          // Клиентът може да го подаде явно (validity_period_sec).
          validity_period_sec: typeof m.validity_period_sec === "number" ? m.validity_period_sec : 60,
          sms_text: m.sms_text ?? m.text,
        })),
      }

      const resp = await mobicaPost("multi/json/viber.php", body) as { code?: string; description?: string }
      const code = String(resp?.code ?? "")
      if (code !== "1004") {
        const desc = REJECT_DESCRIPTIONS[code] ?? resp?.description ?? "неизвестна грешка"
        return json({ error: `Mobica отказа заявката (${code}): ${desc}`, code, description: resp?.description ?? null }, 502)
      }
      return json({ code, description: resp?.description ?? "Message accepted" })
    }

    // ---------- DLR: статуси по нашите reference id-та ----------
    if (payload.action === "dlr") {
      const ids: string[] = Array.isArray(payload.reference_ids) ? payload.reference_ids : []
      if (ids.length === 0) return json({ error: "reference_ids е празен" }, 400)
      if (ids.length > 200) return json({ error: "максимум 200 id-та на заявка" }, 400)
      const resp = await mobicaPost("multi/json/dlr_reference_id.php", {
        user,
        pass,
        dlr: ids.map((reference_id) => ({ reference_id })),
      })
      return json(resp)
    }

    // ---------- Баланс на акаунта ----------
    if (payload.action === "balance") {
      const resp = await mobicaPost("user/account_balance.php", { user, pass })
      return json(resp)
    }

    return json({ error: "невалиден action (send / dlr / balance)" }, 400)
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
