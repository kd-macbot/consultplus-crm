// Supabase Edge Function: admin-create-user
//
// Създава нов потребител с парола, БЕЗ да праща confirmation email.
// Авторизира се извикващият — само admin може да създава.
//
// Deploy:
//   supabase functions deploy admin-create-user --no-verify-jwt
//
// Frontend (от admin-а):
//   POST /functions/v1/admin-create-user
//   headers: Authorization: Bearer <session_access_token>
//   body: { email, password, full_name, role: 'admin'|'manager'|'employee' }
//   → { userId } или { error }

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

    if (!email || typeof email !== "string") return json({ error: "email е задължителен" }, 400)
    if (!password || typeof password !== "string" || password.length < 6) {
      return json({ error: "Паролата трябва да е поне 6 символа" }, 400)
    }
    if (!full_name || typeof full_name !== "string") return json({ error: "full_name е задължителен" }, 400)
    if (!role || !VALID_ROLES.has(role)) return json({ error: "Невалидна роля" }, 400)

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
      .select("role, is_active")
      .eq("id", userData.user.id)
      .single()
    if (callerErr || !caller) return json({ error: "Профилът на извикващия не е намерен" }, 403)
    if (caller.role !== "admin" || caller.is_active === false) {
      return json({ error: "Само администратор може да създава потребители" }, 403)
    }

    // 3) Създаваме user-а с auto-confirmed email (не се праща имейл)
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
