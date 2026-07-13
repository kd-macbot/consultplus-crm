-- ============================================================
-- Migration 042 — Проверяващи на месеца (Работен лист)
-- ============================================================
-- Двама проверяващи per работен месец — хората, които правят
-- финалната проверка („Проверено") преди закриване на месеца.
--
-- Назначават се автоматично на случаен принцип от отдел Счетоводство
-- при първо отваряне на месеца. Сменяеми до 14-то число вкл. на
-- месеца СЛЕД работния (ДДС конвенцията); след това само admin с
-- допълнително потвърждение (контрол в UI).
--
-- Идемпотентно.
-- ============================================================

create table if not exists crm_month_reviewers (
  year int not null,
  month int not null,
  reviewer1_staff_id uuid references crm_staff(id) on delete set null,
  reviewer2_staff_id uuid references crm_staff(id) on delete set null,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  primary key (year, month)
);

alter table crm_month_reviewers enable row level security;

drop policy if exists "month_reviewers_select" on crm_month_reviewers;
drop policy if exists "month_reviewers_insert" on crm_month_reviewers;
drop policy if exists "month_reviewers_update" on crm_month_reviewers;
drop policy if exists "month_reviewers_delete" on crm_month_reviewers;

create policy "month_reviewers_select" on crm_month_reviewers for select to authenticated using (true);
create policy "month_reviewers_insert" on crm_month_reviewers for insert to authenticated with check (true);
create policy "month_reviewers_update" on crm_month_reviewers for update to authenticated using (true) with check (true);
create policy "month_reviewers_delete" on crm_month_reviewers for delete to authenticated using (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_month_reviewers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_month_reviewers;
  END IF;
END $$;
