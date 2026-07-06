-- ============================================================
-- Migration 038 — Банков достъп до клиенти
-- ============================================================
-- Данни за онлайн банкирането на клиентите: банка, URL, потребител,
-- парола, тип достъп (общ/отделен), 2FA, дали плащаме от тях, забележка.
--
-- ⚠️ Паролите се пазят в чист текст. Достъпът е ограничен на ниво RLS
-- до логнати потребители (`to authenticated`). Външен човек без CRM
-- профил НЕ може да чете — anon ролята е блокирана. Филтрирането по
-- отдел (Тийм Лийд / Управление) е в UI layer-а.
--
-- Идемпотентно.
-- ============================================================

create table if not exists crm_bank_access (
  client_id uuid primary key references crm_clients(id) on delete cascade,
  bank text,
  url text,
  username text,
  password text,
  access_type text not null default 'shared',  -- 'shared' (общ) | 'individual' (отделен)
  has_2fa boolean not null default false,
  we_pay boolean not null default false,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

-- RLS — само логнати четат/пишат. Отделовото ограничение е в UI.
alter table crm_bank_access enable row level security;

drop policy if exists "bank_access_select" on crm_bank_access;
drop policy if exists "bank_access_insert" on crm_bank_access;
drop policy if exists "bank_access_update" on crm_bank_access;
drop policy if exists "bank_access_delete" on crm_bank_access;

create policy "bank_access_select" on crm_bank_access
  for select to authenticated using (true);
create policy "bank_access_insert" on crm_bank_access
  for insert to authenticated with check (true);
create policy "bank_access_update" on crm_bank_access
  for update to authenticated using (true) with check (true);
create policy "bank_access_delete" on crm_bank_access
  for delete to authenticated using (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_bank_access'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_bank_access;
  END IF;
END $$;
