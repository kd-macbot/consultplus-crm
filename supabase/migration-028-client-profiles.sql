-- ============================================================
-- Migration 028 — Профили на клиенти (бизнес контекст + червени флагове)
-- ============================================================
-- Една таблица 1:1 към crm_clients (PK = client_id). Държи 3 свободни
-- полета за справка: дейност, особености и „внимавай" бележки.
--
-- Страницата „Профили" в sidebar-а показва всички клиенти (LEFT JOIN),
-- така че нови фирми се появяват автоматично без попълнени полета.
--
-- Идемпотентно: пуска се повторно без грешка.
-- ============================================================

create table if not exists crm_client_profile (
  client_id uuid primary key references crm_clients(id) on delete cascade,
  business_activity text,    -- „Дейност" — кратък текст, с какво се занимават
  business_notes    text,    -- „Особености" — ДДС режим, сезонност, документооборот и т.н.
  warnings          text,    -- „Внимавай" — червени флагове, специфики, проблеми

  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

create index if not exists idx_client_profile_updated on crm_client_profile(updated_at desc);

-- ============================================================
-- RLS — четат и пишат всички логнати. Това е вътрешна справка за
-- колегите, без специфично филтриране по роля (както checklist/contacts).
-- ============================================================
alter table crm_client_profile enable row level security;

drop policy if exists "client_profile_select" on crm_client_profile;
drop policy if exists "client_profile_insert" on crm_client_profile;
drop policy if exists "client_profile_update" on crm_client_profile;
drop policy if exists "client_profile_delete" on crm_client_profile;

create policy "client_profile_select" on crm_client_profile
  for select to authenticated using (true);
create policy "client_profile_insert" on crm_client_profile
  for insert to authenticated with check (true);
create policy "client_profile_update" on crm_client_profile
  for update to authenticated using (true) with check (true);
create policy "client_profile_delete" on crm_client_profile
  for delete to authenticated using (true);

-- Realtime (идемпотентно)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_client_profile'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_client_profile;
  END IF;
END $$;
