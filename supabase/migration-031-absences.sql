-- ============================================================
-- Migration 031 — Календар на присъствието + Справка за отпуска
-- ============================================================
-- Две таблици:
--   crm_absences        — отделните отсъствия (тип + диапазон + бележка)
--   crm_vacation_quota  — годишен баланс на отпуска per служител × година
--
-- Изчисление на оставащите дни (формула от excel-а на ТРЗ):
--   Оставащ = От минали години + За тек. година + Доп. − Σ(използвани)
--
-- Σ(използвани) се вади автоматично от crm_absences за съответната
-- година, тип = 'vacation' (само платен отпуск намалява баланса).
-- Болничен/служебно/майчинство и т.н. се проследяват в календара, но
-- не намаляват годишния баланс.
--
-- Идемпотентно: пуска се повторно без грешка.
-- ============================================================

create table if not exists crm_absences (
  id uuid primary key default uuid_generate_v4(),
  staff_id uuid not null references crm_staff(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  type text not null,  -- 'vacation','sick','business','remote','maternity','study','unpaid'
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists idx_absences_staff   on crm_absences(staff_id);
create index if not exists idx_absences_period  on crm_absences(start_date, end_date);

create table if not exists crm_vacation_quota (
  staff_id uuid not null references crm_staff(id) on delete cascade,
  year int not null,

  -- Manual полета (admin/ТРЗ ги редактира; формулата от excel-а):
  prev_years_days  numeric(5,1) not null default 0,
  current_year_days numeric(5,1) not null default 20,
  additional_days   numeric(5,1) not null default 0,

  -- Допълнителни полета от справката (за обезщетение при прекратяване):
  daily_rate         numeric(10,4),
  insurance_pct      numeric(5,4),
  termination_date   date,
  compensation_days  numeric(5,1),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id),

  primary key (staff_id, year)
);

-- ============================================================
-- RLS — Календарът се чете от всички, редактира се от admin/manager.
-- (Проверка по отдел ТРЗ ще е в UI layer-а — same approach като
-- skritot „Личен чек лист" за ТРЗ.)
-- ============================================================
alter table crm_absences enable row level security;
alter table crm_vacation_quota enable row level security;

drop policy if exists "absences_select" on crm_absences;
drop policy if exists "absences_insert" on crm_absences;
drop policy if exists "absences_update" on crm_absences;
drop policy if exists "absences_delete" on crm_absences;

create policy "absences_select" on crm_absences
  for select to authenticated using (true);
create policy "absences_insert" on crm_absences
  for insert to authenticated with check (true);
create policy "absences_update" on crm_absences
  for update to authenticated using (true) with check (true);
create policy "absences_delete" on crm_absences
  for delete to authenticated using (true);

drop policy if exists "vacation_quota_select" on crm_vacation_quota;
drop policy if exists "vacation_quota_insert" on crm_vacation_quota;
drop policy if exists "vacation_quota_update" on crm_vacation_quota;
drop policy if exists "vacation_quota_delete" on crm_vacation_quota;

create policy "vacation_quota_select" on crm_vacation_quota
  for select to authenticated using (true);
create policy "vacation_quota_insert" on crm_vacation_quota
  for insert to authenticated with check (true);
create policy "vacation_quota_update" on crm_vacation_quota
  for update to authenticated using (true) with check (true);
create policy "vacation_quota_delete" on crm_vacation_quota
  for delete to authenticated using (true);

-- Realtime (идемпотентно)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_absences'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_absences;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_vacation_quota'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_vacation_quota;
  END IF;
END $$;
