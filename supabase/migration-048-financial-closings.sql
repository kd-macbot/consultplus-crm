-- ============================================================
-- Migration 048 — Финансови приключвания (за кредитни/овърдрафт фирми)
-- ============================================================
-- За фирми с master колона „Мониторинг" = ДА се прави периодично
-- приключване: Приходи и Разходи за периода → Резултат (печалба/загуба)
-- се смята в UI. Целта е да се вижда как върви бизнесът във времето.
--
-- Периодът е ПО ФИРМА: месечно ИЛИ тримесечно (crm_financial_settings).
-- Записите пазят period_kind, за да оцелее историята при смяна на ритъма.
--
-- crm_financial_closings: един запис на (клиент, година, вид период, №).
--   period_kind: 'month' (period_no 1-12) | 'quarter' (period_no 1-4)
--
-- Финансови данни → RLS с using(true) за логнати (същият съзнателно приет
-- модел като останалите финансови таблици; виж CLAUDE.md backlog #1).
--
-- Идемпотентно.
-- ============================================================

create table if not exists crm_financial_settings (
  client_id uuid primary key references crm_clients(id) on delete cascade,
  period_kind text not null default 'month',
  updated_at timestamptz not null default now()
);

create table if not exists crm_financial_closings (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  year int not null,
  period_kind text not null default 'month',
  period_no int not null,
  income numeric not null default 0,
  expense numeric not null default 0,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- CHECK constraints (идемпотентно).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_financial_settings_kind_check') THEN
    ALTER TABLE crm_financial_settings
      ADD CONSTRAINT crm_financial_settings_kind_check CHECK (period_kind IN ('month', 'quarter'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_financial_closings_kind_check') THEN
    ALTER TABLE crm_financial_closings
      ADD CONSTRAINT crm_financial_closings_kind_check CHECK (period_kind IN ('month', 'quarter'));
  END IF;
  -- Един запис на клиент × година × вид × номер период.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_financial_closings_uniq') THEN
    ALTER TABLE crm_financial_closings
      ADD CONSTRAINT crm_financial_closings_uniq UNIQUE (client_id, year, period_kind, period_no);
  END IF;
END $$;

create index if not exists idx_fin_closings_client on crm_financial_closings(client_id);
create index if not exists idx_fin_closings_year on crm_financial_closings(year);

alter table crm_financial_settings enable row level security;
alter table crm_financial_closings enable row level security;

drop policy if exists "fin_settings_select" on crm_financial_settings;
drop policy if exists "fin_settings_insert" on crm_financial_settings;
drop policy if exists "fin_settings_update" on crm_financial_settings;
create policy "fin_settings_select" on crm_financial_settings for select to authenticated using (true);
create policy "fin_settings_insert" on crm_financial_settings for insert to authenticated with check (true);
create policy "fin_settings_update" on crm_financial_settings for update to authenticated using (true) with check (true);

drop policy if exists "fin_closings_select" on crm_financial_closings;
drop policy if exists "fin_closings_insert" on crm_financial_closings;
drop policy if exists "fin_closings_update" on crm_financial_closings;
drop policy if exists "fin_closings_delete" on crm_financial_closings;
create policy "fin_closings_select" on crm_financial_closings for select to authenticated using (true);
create policy "fin_closings_insert" on crm_financial_closings for insert to authenticated with check (true);
create policy "fin_closings_update" on crm_financial_closings for update to authenticated using (true) with check (true);
create policy "fin_closings_delete" on crm_financial_closings for delete to authenticated using (true);

-- Realtime (идемпотентно)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_financial_closings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_financial_closings;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_financial_settings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_financial_settings;
  END IF;
END $$;
