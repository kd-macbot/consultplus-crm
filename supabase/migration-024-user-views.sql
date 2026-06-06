-- ============================================================
-- Migration 024 — Запазени изгледи на таблицата (per-user, синхр.)
-- ============================================================
-- Досега „изгледите" на таблица Клиенти се пазеха само в localStorage —
-- per-browser, затова не следваха потребителя между устройства. Тук ги
-- връзваме за акаунта: един ред на потребител, целият store като JSONB.
--
-- localStorage остава като мигновен кеш в клиента; тази таблица е
-- източникът на истина, който се синхронизира при вход от ново устройство.
--
-- Идемпотентно: пуска се повторно без грешка.
-- ============================================================

create table if not exists crm_user_views (
  user_id uuid primary key references auth.users(id) on delete cascade,
  views jsonb not null default '[]'::jsonb,
  active_id text,
  updated_at timestamptz not null default now()
);

alter table crm_user_views enable row level security;

-- Всеки вижда и пише САМО своя ред.
drop policy if exists "user_views_select" on crm_user_views;
drop policy if exists "user_views_insert" on crm_user_views;
drop policy if exists "user_views_update" on crm_user_views;
drop policy if exists "user_views_delete" on crm_user_views;

create policy "user_views_select" on crm_user_views
  for select to authenticated using (auth.uid() = user_id);
create policy "user_views_insert" on crm_user_views
  for insert to authenticated with check (auth.uid() = user_id);
create policy "user_views_update" on crm_user_views
  for update to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "user_views_delete" on crm_user_views
  for delete to authenticated using (auth.uid() = user_id);
