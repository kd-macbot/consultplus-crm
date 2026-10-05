// Supabase Edge Function: admin-create-user
//
// ДВЕ ДЕЙСТВИЯ, една функция:
//   action: "create"          — създава потребител с парола, БЕЗ confirmation email
//   action: "reset_password"  — сменя паролата на СЪЩЕСТВУВАЩ потребител
//
// Втората е тук, а не в отделна функция, по практична причина: edge
// функциите се деплойват РЪЧНО през Dashboard, а нова функция значи
// още един деплой и още secrets. Тази вече е качена.
//
// СЪВМЕСТИМОСТ: липсващ `action` се чете като "create" — старият
// фронтенд продължава да работи с нов деплой на функцията.
//
// Авторизира се извикващият — само admin, и за двете действия.
//
// Deploy:
//   supabase functions deploy admin-create-user --no-verify-jwt
//
// Frontend (от admin-а):
//   POST /functions/v1/admin-create-user
//   headers: Authorization: Bearer <session_access_token>
//   създаване: { email, password, full_name, role: 'admin'|'manager'|'employee' }
//              → { userId } или { error }
//   нулиране:  { action: 'reset_password', email, password }
//              → { userId } или { error }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

const VALID_ROLES = new Set(["admin", "manager", "employee"])

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  try {
    // 1) Прочитаме тялото
    const rawBody = await req.text()
    const payload = rawBody ? JSON.parse(rawBody) : {}
    const { email, password, full_name, role } = payload as {
      email?: string; password?: string; full_name?: string; role?: string
    }
    // Липсващ action = "create" (старият фронтенд не го праща).
    const action = (payload as { action?: string }).action ?? "create"
    if (action !== "create" && action !== "reset_password") {
      return json({ error: "Непознато действие" }, 400)
    }

    if (!email || typeof email !== "string") return json({ error: "email е задължителен" }, 400)
    if (!password || typeof password !== "string" || password.length < 6) {
      return json({ error: "Паролата трябва да е поне 6 символа" }, 400)
    }
    // Име и роля са нужни САМО при създаване — при нулиране нищо друго
    // по профила не се пипа.
    if (action === "create") {
      if (!full_name || typeof full_name !== "string") return json({ error: "full_name е задължителен" }, 400)
      if (!role || !VALID_ROLES.has(role)) return json({ error: "Невалидна роля" }, 400)
    }

    // 2) Проверка че извикващият е admin
    const authHeader = req.headers.get("Authorization") ?? ""
    const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim()
    if (!accessToken) return json({ error: "Липсва Authorization" }, 401)

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    // Клиент с user JWT — за да вземем извикващия user
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser(accessToken)
    if (userErr || !userData.user) return json({ error: "Невалиден токен" }, 401)

    // Проверяваме ролята в profiles
    const adminClient = createClient(supabaseUrl, serviceKey)
    const { data: caller, error: callerErr } = await adminClient
      .from("profiles")
      .select("role, is_active, full_name")
      .eq("id", userData.user.id)
      .single()
    if (callerErr || !caller) return json({ error: "Профилът на извикващия не е намерен" }, 403)
    if (caller.role !== "admin" || caller.is_active === false) {
      return json({ error: "Само администратор може да създава потребители" }, 403)
    }

    // 3а) НУЛИРАНЕ НА ПАРОЛА
    if (action === "reset_password") {
      // Потребителят се намира през profiles (имейлът там се поддържа от
      // самата функция при създаване), а НЕ през listUsers() — последното
      // тегли цялата таблица с потребители заради едно съвпадение.
      const { data: target, error: targetErr } = await adminClient
        .from("profiles")
        .select("id, email, full_name")
        .ilike("email", email)
        .maybeSingle()
      if (targetErr) return json({ error: `Грешка при търсене: ${targetErr.message}` }, 500)
      if (!target) return json({ error: "Няма акаунт с този имейл" }, 404)

      const { error: updErr } = await adminClient.auth.admin.updateUserById(target.id, { password })
      if (updErr) return json({ error: updErr.message ?? "Неуспешна смяна на паролата" }, 400)

      // Дневник: КОЙ на КОГО, кога. Самата парола НЕ се записва никъде.
      await adminClient.from("crm_audit_log").insert([{
        user_id: userData.user.id,
        user_name: caller.full_name ?? userData.user.email ?? "",
        action: "reset_password",
        entity_type: "profile",
        entity_id: target.id,
        new_value: `Нулирана парола на ${target.full_name ?? target.email}`,
        metadata: {},
      }])

      return json({ userId: target.id })
    }

    // 3б) Създаваме user-а с auto-confirmed email (не се праща имейл)
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    })
    if (createErr || !created.user) {
      return json({ error: createErr?.message ?? "Неуспешно създаване на потребител" }, 400)
    }

    const newUserId = created.user.id

    // 4) Upsert на profile с правилната роля + име
    const { error: profileErr } = await adminClient
      .from("profiles")
      .upsert({
        id: newUserId,
        email,
        full_name,
        role,
        is_active: true,
      })
    if (profileErr) {
      // Профилът се проваля → rollback на user-а да не остане сирак
      await adminClient.auth.admin.deleteUser(newUserId)
      return json({ error: `Грешка при запис на профил: ${profileErr.message}` }, 500)
    }

    return json({ userId: newUserId })
  } catch (err) {
    return json({ error: (err as Error).message ?? "Неочаквана грешка" }, 500)
  }
})
