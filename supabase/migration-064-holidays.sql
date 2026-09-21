-- ============================================================
-- 064 — Производствен календар: официални празници и разместени дни
--
-- ЗАЩО ТАБЛИЦА, А НЕ КОД: Великден е подвижен, а разместванията
-- („мостове") се обявяват с решение на МС в края на предходната
-- година. Формула не върши работа; списък върши. Нова година =
-- добавяне на редове, не деплой.
--
-- ЗАЩО `is_working` (в ДВЕТЕ посоки): освен неработни делнични дни
-- има и обявени РАБОТНИ съботи, с които се отработва мост. Ако
-- таблицата пазеше само празниците, работната събота щеше да се
-- брои за почивен ден и Форма 76 щеше да излиза с час по-малко.
-- (През 2026 няма такава, но 2027 може да има.)
-- ============================================================

create table if not exists crm_holidays (
  date        date primary key,
  name        text not null,
  -- false = неработен делничен ден (празник/заместващ/мост)
  -- true  = РАБОТНА събота или неделя (отработване)
  is_working  boolean not null default false,
  created_at  timestamptz not null default now()
);

comment on table crm_holidays is
  'Производствен календар: неработни делнични дни и работни съботи/недели.';

alter table crm_holidays enable row level security;

-- Четат ВСИЧКИ логнати — календарът се ползва в Справка отпуска,
-- Форма 76, Заявки и Календар, тоест на всеки екран с работни дни.
drop policy if exists "holidays_select" on crm_holidays;
create policy "holidays_select" on crm_holidays
  for select to authenticated using (true);

-- Пише само admin. НАРОЧНО три отделни политики вместо една FOR ALL:
-- FOR ALL важи и за SELECT и би изисквала EXECUTE върху helper-а при
-- всяко четене (мигр. 050 вече ни счупи Клиенти точно така).
drop policy if exists "holidays_insert" on crm_holidays;
drop policy if exists "holidays_update" on crm_holidays;
drop policy if exists "holidays_delete" on crm_holidays;
create policy "holidays_insert" on crm_holidays
  for insert to authenticated with check (is_current_user_admin());
create policy "holidays_update" on crm_holidays
  for update to authenticated using (is_current_user_admin()) with check (is_current_user_admin());
create policy "holidays_delete" on crm_holidays
  for delete to authenticated using (is_current_user_admin());

-- ============================================================
-- 2026 — сверено срещу производствения календар на kik.info:
-- 248 работни дни / 1984 часа, и 12-те месеца съвпадат точно.
-- Съботите и неделите НЕ се вписват — те и без това не се броят.
-- ============================================================
insert into crm_holidays (date, name, is_working) values
  ('2026-01-01', 'Нова година',                         false),
  ('2026-01-02', 'Разместен неработен ден',             false),
  ('2026-03-03', 'Ден на Освобождението',               false),
  ('2026-04-10', 'Разпети петък',                       false),
  ('2026-04-13', 'Светли понеделник',                   false),
  ('2026-05-01', 'Ден на труда',                        false),
  ('2026-05-06', 'Гергьовден, Ден на храбростта',       false),
  ('2026-05-25', 'Заместващ за 24.05 (в неделя)',       false),
  ('2026-09-07', 'Заместващ за 06.09 (в неделя)',       false),
  ('2026-09-22', 'Ден на Независимостта',               false),
  ('2026-12-24', 'Бъдни вечер',                         false),
  ('2026-12-25', 'Рождество Христово',                  false),
  ('2026-12-28', 'Заместващ за 26.12 (в събота)',       false)
on conflict (date) do nothing;

notify pgrst, 'reload schema';
