-- ============================================================
-- Migration 030 — Плащания (банкови плащания, които правим за клиенти)
-- ============================================================
-- Заменя excel таблицата за месечни плащания на РЗ / осиг / ДДС, които
-- счетоводната фирма извършва от името на клиента.
--
-- Две таблици:
--   crm_payment_config  — кои клиенти проследяваме + типове + банка + бележка
--   crm_payment_status  — checkbox „платено" per (клиент × тип × година × месец)
--
-- Идемпотентно: пуска се повторно без грешка.
-- ============================================================

create table if not exists crm_payment_config (
  client_id uuid primary key references crm_clients(id) on delete cascade,
  payment_types text[] not null default '{}'::text[],  -- ['РЗ','осиг','ДДС']
  bank text,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

create table if not exists crm_payment_status (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  payment_type text not null,
  year int not null,
  month int not null,
  paid boolean not null default false,
  paid_at timestamptz,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (client_id, payment_type, year, month)
);

create index if not exists idx_payment_status_period on crm_payment_status(year, month);
create index if not exists idx_payment_status_client on crm_payment_status(client_id);

-- ============================================================
-- RLS — четат и пишат всички логнати. (Като чеклист — споделени данни
-- между колегите, без специфично филтриране по роля.)
-- ============================================================
alter table crm_payment_config enable row level security;
alter table crm_payment_status enable row level security;

drop policy if exists "payment_config_select" on crm_payment_config;
drop policy if exists "payment_config_insert" on crm_payment_config;
drop policy if exists "payment_config_update" on crm_payment_config;
drop policy if exists "payment_config_delete" on crm_payment_config;

create policy "payment_config_select" on crm_payment_config
  for select to authenticated using (true);
create policy "payment_config_insert" on crm_payment_config
  for insert to authenticated with check (true);
create policy "payment_config_update" on crm_payment_config
  for update to authenticated using (true) with check (true);
create policy "payment_config_delete" on crm_payment_config
  for delete to authenticated using (true);

drop policy if exists "payment_status_select" on crm_payment_status;
drop policy if exists "payment_status_insert" on crm_payment_status;
drop policy if exists "payment_status_update" on crm_payment_status;
drop policy if exists "payment_status_delete" on crm_payment_status;

create policy "payment_status_select" on crm_payment_status
  for select to authenticated using (true);
create policy "payment_status_insert" on crm_payment_status
  for insert to authenticated with check (true);
create policy "payment_status_update" on crm_payment_status
  for update to authenticated using (true) with check (true);
create policy "payment_status_delete" on crm_payment_status
  for delete to authenticated using (true);

-- Realtime (идемпотентно)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_payment_config'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_payment_config;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_payment_status'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_payment_status;
  END IF;
END $$;
