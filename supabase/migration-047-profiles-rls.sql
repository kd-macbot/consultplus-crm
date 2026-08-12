-- ============================================================
-- Migration 047 — Включване на RLS върху profiles (security fix)
-- ============================================================
-- ПРОБЛЕМ: таблицата profiles има дефинирани политики от migration-006,
-- но самият RLS никога не е бил включван (липсваше
-- `alter table profiles enable row level security`). Политиките са
-- безсилни при изключен RLS → таблицата е публично достъпна с anon
-- ключа. Supabase я маркира като rls_disabled_in_public (CRITICAL).
--
-- profiles държи ролите (admin/manager/employee), затова е важно.
--
-- ТОВА НЕ Е стягане на финансовите таблици (те съзнателно са using(true)
-- с ВКЛЮЧЕН RLS — приет риск в CLAUDE.md). Тук просто активираме вече
-- написания, коректен модел: свой ред + admin вижда/редактира всичко.
--
-- Идемпотентно — преутвърждаваме и политиките, за да е самостоятелна.
-- ============================================================

-- Security-definer helper (преутвърждаваме — без рекурсия при проверка на роля).
create or replace function is_current_user_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

alter table profiles enable row level security;

drop policy if exists "profiles_select_own" on profiles;
drop policy if exists "profiles_update_own" on profiles;
drop policy if exists "profiles_select"     on profiles;
drop policy if exists "profiles_update"     on profiles;
drop policy if exists "profiles_insert"     on profiles;

-- Всеки вижда своя ред; admin вижда всички.
create policy "profiles_select" on profiles
  for select using (auth.uid() = id or is_current_user_admin());

-- Всеки редактира своя ред; admin редактира всеки.
create policy "profiles_update" on profiles
  for update using (auth.uid() = id or is_current_user_admin());

-- Insert само от admin (реалното създаване минава през service-role edge
-- функцията admin-create-user, която заобикаля RLS).
create policy "profiles_insert" on profiles
  for insert with check (is_current_user_admin());
