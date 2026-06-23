-- ============================================================
-- Migration 033 — Форма 76 (ТРЗ образец „Отчитане явяване/неявяване")
-- ============================================================
-- Таблица за override на отделни клетки в Форма 76 grid-а. Дефолтите
-- (8 за работен ден, код за отсъствие, празно за уикенд) се изчисляват
-- от crm_absences + календара — те НЕ се пишат в БД. Тук пишем САМО
-- ръчно зададените от ТРЗ/admin override-и.
--
-- Пример: служител има отпуска 10-15 март (от календара). За 12 март
-- ТРЗ override-ва клетката на „8" (служителят дошъл на работа за
-- спешно нещо) → пишем един ред (staff_id, 2026, 3, 12, '8').
--
-- Идемпотентно.
-- ============================================================

create table if not exists crm_form76_overrides (
  staff_id uuid not null references crm_staff(id) on delete cascade,
  year int not null,
  month int not null,
  day int not null check (day >= 1 and day <= 31),
  value text not null,  -- '8', 'О', 'Б', 'М', 'К', 'У', 'Н', '-', '' (празно)
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  primary key (staff_id, year, month, day)
);

create index if not exists idx_form76_period on crm_form76_overrides(year, month);

alter table crm_form76_overrides enable row level security;

drop policy if exists "form76_select" on crm_form76_overrides;
drop policy if exists "form76_insert" on crm_form76_overrides;
drop policy if exists "form76_update" on crm_form76_overrides;
drop policy if exists "form76_delete" on crm_form76_overrides;

create policy "form76_select" on crm_form76_overrides
  for select to authenticated using (true);
create policy "form76_insert" on crm_form76_overrides
  for insert to authenticated with check (true);
create policy "form76_update" on crm_form76_overrides
  for update to authenticated using (true) with check (true);
create policy "form76_delete" on crm_form76_overrides
  for delete to authenticated using (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_form76_overrides'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_form76_overrides;
  END IF;
END $$;
