-- ============================================================
-- Migration 045 — Каси и заеми (месечни записи за деклариране)
-- ============================================================
-- Модел като crm_art55_entries: няколко записа на клиент × месец,
-- всеки запис е „Каса" или „Заем" със сума (ДВИЖЕНИЕ за месеца) и
-- бележка (напр. към кого е заемът). Акумулираното се смята в UI
-- като сбор от началото на годината.
--
-- Въвежда се от Работния лист (клетка „Каса/Заем" до „Банка"),
-- обобщава се в нова страница „Каси и заеми".
--
-- Идемпотентно.
-- ============================================================

create table if not exists crm_cash_loan_entries (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  year int not null,
  month int not null,
  kind text not null default 'cash',
  amount numeric not null default 0,
  note text,
  position double precision not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- CHECK constraint за вида (идемпотентно).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_cash_loan_entries_kind_check'
  ) THEN
    ALTER TABLE crm_cash_loan_entries
      ADD CONSTRAINT crm_cash_loan_entries_kind_check
      CHECK (kind IN ('cash', 'loan'));
  END IF;
END $$;

create index if not exists idx_cash_loan_client on crm_cash_loan_entries(client_id);
create index if not exists idx_cash_loan_period on crm_cash_loan_entries(year, month);

alter table crm_cash_loan_entries enable row level security;

drop policy if exists "cash_loan_select" on crm_cash_loan_entries;
drop policy if exists "cash_loan_insert" on crm_cash_loan_entries;
drop policy if exists "cash_loan_update" on crm_cash_loan_entries;
drop policy if exists "cash_loan_delete" on crm_cash_loan_entries;

create policy "cash_loan_select" on crm_cash_loan_entries for select to authenticated using (true);
create policy "cash_loan_insert" on crm_cash_loan_entries for insert to authenticated with check (true);
create policy "cash_loan_update" on crm_cash_loan_entries for update to authenticated using (true) with check (true);
create policy "cash_loan_delete" on crm_cash_loan_entries for delete to authenticated using (true);

-- Realtime (идемпотентно)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_cash_loan_entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_cash_loan_entries;
  END IF;
END $$;
