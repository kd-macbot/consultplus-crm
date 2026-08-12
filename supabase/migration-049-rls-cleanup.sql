-- ============================================================
-- Migration 049 — RLS/performance почистване (Supabase Advisor lints)
-- ============================================================
-- Отстранява WARN-ове от Advisor-а + затваря реален пропуск в profiles.
--
-- КОНТЕКСТ: на живо имаше ДВА комплекта политики върху някои таблици —
-- нашите (от миграциите) + втори „публичен" набор, правен през Dashboard.
-- Това пораждаше multiple_permissive_policies и част от auth_rls_initplan.
-- Тук махаме дублиращия набор и оставяме по един чист.
--
-- ⚠️ profiles_read (SELECT using(true) за роля public) правеше ВСИЧКИ
-- профили публично четими с anon ключа (имейли + роли). Махаме я —
-- остава profiles_select (свой ред + admin). Приложението чете само
-- своя профил (логин) и admin-панелите четат всички → не се чупи.
--
-- Точките отговарят на прегледа: (2) дублиран индекс, (3) search_path,
-- (4) initplan — auth.uid() → (select auth.uid()), (5) дублиращи
-- политики, (6) revoke на публично викаеми SECURITY DEFINER функции.
--
-- НЕ пипаме using(true) модела на финансовите/справочните таблици —
-- съзнателно приет риск (CLAUDE.md). Идемпотентно.
-- ============================================================

-- ---- (2) Дублиран индекс на crm_cell_values (голямата таблица) --------
-- idx_cells_col и idx_cells_column са идентични. Пазим idx_cells_col
-- (създава се от migration-015), махаме дубликата.
drop index if exists public.idx_cells_column;

-- ---- (3)+(6) SECURITY DEFINER функции ---------------------------------
-- handle_new_user / rls_auto_enable — не бива да са публично викаеми през
--   RPC → revoke от anon и authenticated (тригер/поддръжка ги ползват в
--   собствен контекст, не през ролята на потребителя).
-- handle_new_user — фиксираме и search_path (function_search_path_mutable).
-- is_current_user_admin(_or_manager) — НУЖНИ са в RLS политиките, затова
--   ги оставяме за authenticated; махаме само anon (безобидни — връщат
--   само дали ТЕКУЩИЯТ потребител е админ).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('handle_new_user', 'rls_auto_enable', 'is_current_user_admin', 'is_current_user_admin_or_manager')
  LOOP
    IF r.proname IN ('handle_new_user', 'rls_auto_enable') THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', r.sig);
    ELSE
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    END IF;
    IF r.proname = 'handle_new_user' THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.sig);
    END IF;
  END LOOP;
END $$;

-- ---- (5) Махаме дублиращия „публичен" набор политики ------------------
-- crm_cell_values: пазим cell_values_* (нашите), махаме cells_*.
drop policy if exists "cells_read"   on crm_cell_values;
drop policy if exists "cells_insert" on crm_cell_values;
drop policy if exists "cells_update" on crm_cell_values;
drop policy if exists "cells_delete" on crm_cell_values;

-- crm_dropdown_options: пазим dropdown_options_* (нашите), махаме dropdown_*.
drop policy if exists "dropdown_read"  on crm_dropdown_options;
drop policy if exists "dropdown_write" on crm_dropdown_options;

-- ---- profiles: затваряме публичното четене + (4) initplan ------------
drop policy if exists "profiles_read"   on profiles;
drop policy if exists "profiles_select" on profiles;
drop policy if exists "profiles_update" on profiles;
create policy "profiles_select" on profiles for select to authenticated
  using (((select auth.uid()) = id) or is_current_user_admin());
create policy "profiles_update" on profiles for update to authenticated
  using (((select auth.uid()) = id) or is_current_user_admin());

-- ---- (4) initplan — crm_contacts -------------------------------------
-- (auth.uid() IS NOT NULL) при роля authenticated = винаги true.
-- Пишат admin/manager (helper функция — без директен auth.uid).
drop policy if exists "contacts_read"  on crm_contacts;
drop policy if exists "contacts_write" on crm_contacts;
create policy "contacts_read" on crm_contacts for select to authenticated using (true);
create policy "contacts_write" on crm_contacts for all to authenticated
  using (is_current_user_admin_or_manager()) with check (is_current_user_admin_or_manager());

-- ---- (4) initplan — crm_user_views (own row) -------------------------
drop policy if exists "user_views_select" on crm_user_views;
drop policy if exists "user_views_insert" on crm_user_views;
drop policy if exists "user_views_update" on crm_user_views;
drop policy if exists "user_views_delete" on crm_user_views;
create policy "user_views_select" on crm_user_views for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "user_views_insert" on crm_user_views for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "user_views_update" on crm_user_views for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "user_views_delete" on crm_user_views for delete to authenticated
  using ((select auth.uid()) = user_id);
