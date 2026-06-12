-- ===========================================================
-- Combined migrations 002 → 024 за пускане на dev среда
-- ===========================================================
-- Този файл обединява всички миграции след 001-initial-schema.
-- Генериран автоматично — НЕ редактирай ръчно. Източникът е
-- индивидуалните migration-XXX-*.sql файлове.
-- ===========================================================


-- ===========================================================
-- >>> migration-002-staff.sql
-- ===========================================================
-- ============================================
-- Migration 002 — Staff / Personnel Table
-- ============================================

create table crm_staff (
  id uuid primary key default uuid_generate_v4(),
  full_name text not null,
  position text,
  department text,
  email text,
  phone text,
  is_active bool not null default true,
  created_at timestamptz not null default now()
);

create index idx_staff_active on crm_staff(is_active);
create index idx_staff_department on crm_staff(department);

alter table crm_staff enable row level security;

create policy "staff_read" on crm_staff for select using (true);
create policy "staff_write" on crm_staff for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);


-- ===========================================================
-- >>> migration-003-audit-tags.sql
-- ===========================================================
-- Audit Log table
create table crm_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  user_name text not null,
  action text not null, -- 'create_client', 'update_cell', 'delete_client', 'create_column', 'delete_column', etc.
  entity_type text not null, -- 'client', 'column', 'dropdown', 'cell'
  entity_id uuid,
  client_name text, -- denormalized for quick display
  column_name text, -- denormalized
  old_value text,
  new_value text,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);

create index idx_audit_created on crm_audit_log(created_at desc);
create index idx_audit_user on crm_audit_log(user_id);
create index idx_audit_entity on crm_audit_log(entity_type, entity_id);

alter table crm_audit_log enable row level security;
create policy "audit_read" on crm_audit_log for select using (true);
create policy "audit_insert" on crm_audit_log for insert with check (true);

-- Tags tables
create table crm_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#6B7280',
  created_at timestamptz not null default now()
);

create table crm_client_tags (
  client_id uuid references crm_clients(id) on delete cascade,
  tag_id uuid references crm_tags(id) on delete cascade,
  primary key (client_id, tag_id)
);

alter table crm_tags enable row level security;
alter table crm_client_tags enable row level security;
create policy "tags_read" on crm_tags for select using (true);
create policy "tags_write" on crm_tags for all using (true);
create policy "client_tags_read" on crm_client_tags for select using (true);
create policy "client_tags_write" on crm_client_tags for all using (true);


-- ===========================================================
-- >>> migration-004-expenses.sql
-- ===========================================================
-- ============================================
-- Migration 004 — Expenses Table
-- ============================================

create table crm_expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  description text,
  amount numeric not null,
  currency text not null default 'EUR',
  date date not null,
  staff_id uuid references crm_staff(id),
  recurring boolean not null default false,
  recurring_period text, -- 'monthly', 'quarterly', 'yearly'
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_expenses_date on crm_expenses(date desc);
create index idx_expenses_category on crm_expenses(category);
create index idx_expenses_staff on crm_expenses(staff_id);
create index idx_expenses_created_by on crm_expenses(created_by);

alter table crm_expenses enable row level security;
create policy "expenses_read" on crm_expenses for select using (true);
create policy "expenses_insert" on crm_expenses for insert with check (true);
create policy "expenses_update" on crm_expenses for update using (true);
create policy "expenses_delete" on crm_expenses for delete using (true);


-- ===========================================================
-- >>> migration-005-subscriptions.sql
-- ===========================================================
-- ============================================
-- Migration 005 — Subscriptions + Expenses cleanup
-- ============================================

-- Make date nullable on crm_expenses (fixed monthly costs don't need a date)
alter table crm_expenses alter column date drop not null;

-- Subscriptions table
create table crm_subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references crm_clients(id),
  amount numeric not null,
  currency text not null default 'EUR',
  payment_period text not null default 'monthly',
  notes text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_subscriptions_client on crm_subscriptions(client_id);
create index idx_subscriptions_active on crm_subscriptions(is_active);

alter table crm_subscriptions enable row level security;
create policy "subscriptions_read" on crm_subscriptions for select using (true);
create policy "subscriptions_insert" on crm_subscriptions for insert with check (true);
create policy "subscriptions_update" on crm_subscriptions for update using (true);
create policy "subscriptions_delete" on crm_subscriptions for delete using (true);


-- ===========================================================
-- >>> migration-006-profiles-admin.sql
-- ===========================================================
-- ============================================
-- Migration 006 — Profiles: admin management
-- ============================================

-- Add is_active flag so admins can deactivate users without deleting them
alter table profiles add column if not exists is_active bool not null default true;

-- Security-definer helper: avoids RLS recursion when checking admin role
create or replace function is_current_user_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Drop any existing policies we are replacing (safe even if they don't exist)
drop policy if exists "profiles_select_own"   on profiles;
drop policy if exists "profiles_update_own"   on profiles;
drop policy if exists "profiles_select"        on profiles;
drop policy if exists "profiles_update"        on profiles;
drop policy if exists "profiles_insert"        on profiles;

-- Users see their own row; admins see all rows
create policy "profiles_select" on profiles
  for select using (
    auth.uid() = id or is_current_user_admin()
  );

-- Users update their own row; admins update any row
create policy "profiles_update" on profiles
  for update using (
    auth.uid() = id or is_current_user_admin()
  );

-- Only admins can insert new profile rows (created after auth.signUp)
create policy "profiles_insert" on profiles
  for insert with check (
    is_current_user_admin()
  );


-- ===========================================================
-- >>> migration-007-contacts.sql
-- ===========================================================
-- ============================================
-- Migration 007 — Contacts (1:1 with clients)
-- ============================================

create table crm_contacts (
  id          uuid primary key default uuid_generate_v4(),
  client_id   uuid not null unique references crm_clients(id) on delete cascade,
  owner_name  text,
  owner_email text,
  owner_phone text,
  manager_name  text,
  manager_email text,
  company_email text,
  eik         text,
  vat_number  text,
  address     text,
  website     text,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);

create index idx_contacts_client on crm_contacts(client_id);

alter table crm_contacts enable row level security;

-- All authenticated users can read contacts
create policy "contacts_read" on crm_contacts
  for select using (auth.uid() is not null);

-- Only admin and manager can insert / update / delete
create policy "contacts_write" on crm_contacts
  for all using (
    exists (
      select 1 from profiles
      where id = auth.uid() and role in ('admin', 'manager')
    )
  );


-- ===========================================================
-- >>> migration-008-regdata-token.sql
-- ===========================================================
-- ============================================
-- Migration 008 — RegData token cache
-- Кеш на accessToken/refreshToken от regdata.apis.bg
-- ============================================

create table crm_regdata_token (
  id            int primary key default 1,
  access_token  text not null,
  refresh_token text,
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default now(),
  constraint single_row check (id = 1)
);

alter table crm_regdata_token enable row level security;

-- Никой клиент няма пряк достъп — само service_role (edge functions, скриптове)
-- → не добавяме policy за read/write от обикновени потребители.


-- ===========================================================
-- >>> migration-009-contacts-vat-url.sql
-- ===========================================================
-- Migration 009: extra fields in crm_contacts populated from regdata
--
-- vat_registered_at: дата на регистрация по ДДС (от vat.states[].date)
-- public_url: линк към публичния запис в web.apis.bg
--
-- Run in Supabase SQL Editor.

ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS vat_registered_at date;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS public_url text;


-- ===========================================================
-- >>> migration-010-staff-departments.sql
-- ===========================================================
-- Migration 010: свързване на колони с отдели + преименуване на „Заместване" → „Отговорник"
--
-- След като пуснеш този SQL:
-- • Колоната „Счетоводител" ще показва активни служители от отдел „Счетоводство"
-- • Колоната „Отговорник" (преди „Заместване") ще показва от „Тийм Лийд"
-- • Колоната „ТРЗ" ще показва от отдел „ТРЗ"
--
-- Старите ръчни dropdown стойности се мигрират към value_text, за да не се загубят.
-- Ако някое от имената не съвпада с активен служител — клетката ще се показва празна,
-- докато не я редактираш.

-- 1) Rename "Заместване" → "Отговорник"
UPDATE crm_columns
SET name = 'Отговорник'
WHERE name = 'Заместване';

-- 2) Migrate value_dropdown → value_text за всички cells в тези три колони
WITH target_cols AS (
  SELECT id FROM crm_columns WHERE name IN ('Счетоводител', 'Отговорник', 'ТРЗ')
)
UPDATE crm_cell_values cv
SET value_text = opt.value, value_dropdown = NULL
FROM crm_dropdown_options opt
WHERE cv.column_id IN (SELECT id FROM target_cols)
  AND cv.value_dropdown = opt.id;

-- 3) Свързване на колоните с отделите
UPDATE crm_columns SET staff_department = 'Счетоводство' WHERE name = 'Счетоводител';
UPDATE crm_columns SET staff_department = 'Тийм Лийд'    WHERE name = 'Отговорник';
UPDATE crm_columns SET staff_department = 'ТРЗ'          WHERE name = 'ТРЗ';


-- ===========================================================
-- >>> migration-011-opportunities.sql
-- ===========================================================
-- Migration 011: Opportunities (потенциални клиенти / sales pipeline)

CREATE TABLE IF NOT EXISTS crm_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Идентификация (същата структура като контактите за лесна миграция)
  name text NOT NULL,
  eik text,
  vat_number text,
  vat_registered_at date,
  address text,
  public_url text,
  owner_name_legal text,        -- собственик (физ. лице) от регистъра
  manager_name_legal text,      -- управляващ (физ. лице) от регистъра

  -- Pipeline
  stage text NOT NULL DEFAULT 'Нов',
  estimated_value numeric(12, 2),
  source text,

  -- Отговорник в нашата компания (имена като в Клиенти, ползва се staff_department)
  responsible text,

  -- Follow-up
  next_action text,
  next_action_date date,

  -- Контактни данни на потенциалния клиент
  contact_person text,
  contact_phone text,
  contact_email text,

  -- State + история
  notes text,
  lost_reason text,
  converted_to_client_id uuid REFERENCES crm_clients(id) ON DELETE SET NULL,
  converted_at timestamptz,

  -- Audit
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_opp_stage ON crm_opportunities(stage) WHERE deleted = false;
CREATE INDEX IF NOT EXISTS idx_opp_next_action ON crm_opportunities(next_action_date) WHERE deleted = false;
CREATE INDEX IF NOT EXISTS idx_opp_responsible ON crm_opportunities(responsible) WHERE deleted = false;

-- RLS — всички authenticated виждат и редактират (като клиентите)
ALTER TABLE crm_opportunities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "opp_select" ON crm_opportunities;
CREATE POLICY "opp_select" ON crm_opportunities FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "opp_insert" ON crm_opportunities;
CREATE POLICY "opp_insert" ON crm_opportunities FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "opp_update" ON crm_opportunities;
CREATE POLICY "opp_update" ON crm_opportunities FOR UPDATE TO authenticated USING (true);


-- ===========================================================
-- >>> migration-012-monthly-work.sql
-- ===========================================================
-- Migration 012: Monthly work sheet (месечен работен лист)
--
-- Един ред = (клиент × година × месец). Месечните полета (РЕЗУЛТАТ, ДДС ОСЧЕТ,
-- АМОР, БАНКА, ЗАПЛАТИ, …) се пълнят всеки месец отначало. Постоянните полета
-- остават в crm_columns / crm_cell_values (мастер).

CREATE TABLE IF NOT EXISTS crm_monthly_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE,
  year integer NOT NULL CHECK (year >= 2000 AND year <= 2100),
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),

  -- Counter accountant fields
  priority_vat boolean NOT NULL DEFAULT false,        -- „приоритетно подаване на ДДС"
  result_amount numeric(12, 2),                       -- РЕЗУЛТАТ €
  submitted_at date,                                  -- ПОДАДЕНО НА
  notification_method text,                           -- УВЕДОМЕНИ — Вайбър/Слак/Имейл/Друго
  npa_inconsistencies text,                           -- НЕСЪОТВЕТСТВИЯ НАП

  -- Checklist
  vat_accounted boolean NOT NULL DEFAULT false,       -- ДДС ОСЧЕТ
  amortization_done boolean NOT NULL DEFAULT false,   -- АМОР
  bank_done boolean NOT NULL DEFAULT false,           -- БАНКА
  salaries_done boolean NOT NULL DEFAULT false,       -- ЗАПЛАТИ

  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(client_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_mwork_year_month ON crm_monthly_work(year, month);
CREATE INDEX IF NOT EXISTS idx_mwork_client ON crm_monthly_work(client_id);

ALTER TABLE crm_monthly_work ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mwork_select" ON crm_monthly_work;
CREATE POLICY "mwork_select" ON crm_monthly_work FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "mwork_insert" ON crm_monthly_work;
CREATE POLICY "mwork_insert" ON crm_monthly_work FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "mwork_update" ON crm_monthly_work;
CREATE POLICY "mwork_update" ON crm_monthly_work FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "mwork_delete" ON crm_monthly_work;
CREATE POLICY "mwork_delete" ON crm_monthly_work FOR DELETE TO authenticated USING (true);


-- ===========================================================
-- >>> migration-013-advance-art55.sql
-- ===========================================================
-- Migration 013: Авансови вноски + чл. 55 ЗДДФЛ
--
-- 1. Два нови мастер колони (постоянни за клиент):
--    - Авансови вноски (НЕ / Месечни / Тримесечни)
--    - Чл. 55 ЗДДФЛ   (ДА / НЕ)
-- 2. Две нови месечни полета в crm_monthly_work:
--    - advance_payment_done  (отметка: платена/декларирана за този месец)
--    - art55_declared        (отметка: декларация чл.55 подадена за това тримесечие)
--
-- UI логика (frontend):
--   - „Месечни" авансови      → показват се всеки месец, винаги акцентирани
--   - „Тримесечни" авансови   → акцент в месеци 4, 7, 10 (срок 15-то на месеца)
--   - „чл. 55 = ДА"           → акцент в месеци 1, 4, 7, 10 (срок края на месеца)

-- ============== 1. MASTER КОЛОНИ ==============
DO $$
DECLARE
  max_pos integer;
  adv_col_id uuid;
  art55_col_id uuid;
BEGIN
  SELECT COALESCE(MAX(position), -1) INTO max_pos FROM crm_columns;

  -- Авансови вноски
  IF NOT EXISTS (SELECT 1 FROM crm_columns WHERE name = 'Авансови вноски') THEN
    max_pos := max_pos + 1;
    INSERT INTO crm_columns (name, type, position, is_required)
      VALUES ('Авансови вноски', 'dropdown', max_pos, false)
      RETURNING id INTO adv_col_id;

    INSERT INTO crm_dropdown_options (column_id, value, position) VALUES
      (adv_col_id, 'НЕ', 0),
      (adv_col_id, 'Месечни', 1),
      (adv_col_id, 'Тримесечни', 2);
  END IF;

  -- Чл. 55 ЗДДФЛ
  IF NOT EXISTS (SELECT 1 FROM crm_columns WHERE name = 'Чл. 55 ЗДДФЛ') THEN
    max_pos := max_pos + 1;
    INSERT INTO crm_columns (name, type, position, is_required)
      VALUES ('Чл. 55 ЗДДФЛ', 'dropdown', max_pos, false)
      RETURNING id INTO art55_col_id;

    INSERT INTO crm_dropdown_options (column_id, value, position) VALUES
      (art55_col_id, 'НЕ', 0),
      (art55_col_id, 'ДА', 1);
  END IF;
END $$;

-- ============== 2. МЕСЕЧНИ ПОЛЕТА ==============
ALTER TABLE crm_monthly_work
  ADD COLUMN IF NOT EXISTS advance_payment_done boolean NOT NULL DEFAULT false;

ALTER TABLE crm_monthly_work
  ADD COLUMN IF NOT EXISTS art55_declared boolean NOT NULL DEFAULT false;


-- ===========================================================
-- >>> migration-014-advance-art55-amounts.sql
-- ===========================================================
-- Migration 014: Авансови вноски + Чл. 55 — суми и тримесечни статуси
--
-- Промени спрямо MVP-то от Migration 013:
-- 1. Авансовите минават от чекбокс → числово поле "сума"
-- 2. Чл. 55 от чекбокс → 1-към-много entries (gross / tax / тип) на месец
-- 3. Чл. 55 декларацията е тримесечна → отделна таблица за status
-- 4. Нова мастер числова колона: „Аванс. — мин. годишна сума"

-- ============== 1. crm_monthly_work — добавя amount, дроп checkbox-ите ==============
ALTER TABLE crm_monthly_work
  ADD COLUMN IF NOT EXISTS advance_payment_amount numeric(12, 2);

-- Дропваме старите boolean-и (от 013-та). Никакви данни не са въвеждани още
-- (новата фийчъра е току що пусната) → безопасно е.
ALTER TABLE crm_monthly_work DROP COLUMN IF EXISTS advance_payment_done;
ALTER TABLE crm_monthly_work DROP COLUMN IF EXISTS art55_declared;

-- ============== 2. crm_art55_entries — множествени записи на месец ==============
CREATE TABLE IF NOT EXISTS crm_art55_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE,
  year integer NOT NULL CHECK (year >= 2000 AND year <= 2100),
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),

  gross_amount numeric(12, 2) NOT NULL DEFAULT 0,
  tax_amount numeric(12, 2) NOT NULL DEFAULT 0,
  income_type text,  -- 'дивидент' | 'наем' | 'лихва' | 'друго'

  position integer NOT NULL DEFAULT 0,  -- подреждане в рамките на месеца
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_art55_client_period ON crm_art55_entries(client_id, year, month);

ALTER TABLE crm_art55_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "art55_select" ON crm_art55_entries;
CREATE POLICY "art55_select" ON crm_art55_entries FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "art55_insert" ON crm_art55_entries;
CREATE POLICY "art55_insert" ON crm_art55_entries FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "art55_update" ON crm_art55_entries;
CREATE POLICY "art55_update" ON crm_art55_entries FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "art55_delete" ON crm_art55_entries;
CREATE POLICY "art55_delete" ON crm_art55_entries FOR DELETE TO authenticated USING (true);

-- ============== 3. crm_art55_quarter_status — тримесечен статус ==============
CREATE TABLE IF NOT EXISTS crm_art55_quarter_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE,
  year integer NOT NULL CHECK (year >= 2000 AND year <= 2100),
  quarter integer NOT NULL CHECK (quarter >= 1 AND quarter <= 4),

  declared boolean NOT NULL DEFAULT false,        -- ОК / x
  notification_method text,                       -- слак / мейл / тел / друго
  declared_at date,
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(client_id, year, quarter)
);
CREATE INDEX IF NOT EXISTS idx_art55q_year_quarter ON crm_art55_quarter_status(year, quarter);

ALTER TABLE crm_art55_quarter_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "art55q_select" ON crm_art55_quarter_status;
CREATE POLICY "art55q_select" ON crm_art55_quarter_status FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "art55q_insert" ON crm_art55_quarter_status;
CREATE POLICY "art55q_insert" ON crm_art55_quarter_status FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "art55q_update" ON crm_art55_quarter_status;
CREATE POLICY "art55q_update" ON crm_art55_quarter_status FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "art55q_delete" ON crm_art55_quarter_status;
CREATE POLICY "art55q_delete" ON crm_art55_quarter_status FOR DELETE TO authenticated USING (true);

-- ============== 4. Мастер „Аванс. — мин. годишна сума" ==============
DO $$
DECLARE
  max_pos integer;
BEGIN
  SELECT COALESCE(MAX(position), -1) INTO max_pos FROM crm_columns;
  IF NOT EXISTS (SELECT 1 FROM crm_columns WHERE name = 'Аванс. мин. годишна сума') THEN
    INSERT INTO crm_columns (name, type, position, is_required)
      VALUES ('Аванс. мин. годишна сума', 'number', max_pos + 1, false);
  END IF;
END $$;


-- ===========================================================
-- >>> migration-015-performance-indexes.sql
-- ===========================================================
-- Migration 015: Индекси за производителност
--
-- До сега имахме индекси само на новите таблици (monthly_work, art55,
-- opportunities). Тук добавяме индекси на горещите пътеки в основните
-- таблици (cell_values, clients, contacts, expenses, audit_log).
--
-- Очакван ефект: 50–500× по-бързи queries при данни > 1000 реда.
-- Без CONCURRENTLY — на малки таблици се случва под секунда, без локове.

-- =========================================================
-- crm_cell_values — НАЙ-горещата таблица
-- =========================================================
-- Заявки: WHERE client_id = X, WHERE column_id = Y, WHERE client_id AND column_id.
-- Композитният (client_id, column_id) покрива и единичните търсения по client_id.
CREATE INDEX IF NOT EXISTS idx_cells_client_col
  ON crm_cell_values(client_id, column_id);

CREATE INDEX IF NOT EXISTS idx_cells_col
  ON crm_cell_values(column_id);

-- =========================================================
-- crm_clients
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_clients_assigned
  ON crm_clients(assigned_to) WHERE deleted = false;

-- Soft-delete филтър — повечето заявки филтрират по deleted = false
CREATE INDEX IF NOT EXISTS idx_clients_not_deleted
  ON crm_clients(id) WHERE deleted = false;

-- Бележка: crm_contacts.client_id е UNIQUE → има автоматичен индекс.
-- crm_expenses няма client_id (линк е към staff_id, не клиент) — индекси по
-- date/category/staff/created_by вече се добавиха в Migration 004.

-- =========================================================
-- crm_audit_log — рядко пишеме, често четем по дата/потребител
-- (idx_audit_created вече съществува от Migration 003)
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_audit_user_created
  ON crm_audit_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_action_created
  ON crm_audit_log(action, created_at DESC);

-- =========================================================
-- crm_dropdown_options — заявки винаги WHERE column_id = X
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_dropdown_col
  ON crm_dropdown_options(column_id);

-- =========================================================
-- crm_client_tags — many-to-many lookup
-- PK е (client_id, tag_id) → има автоматичен индекс по client_id; добавяме
-- само reverse lookup по tag_id.
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_ctags_tag
  ON crm_client_tags(tag_id);

-- =========================================================
-- crm_staff — by department
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_staff_department
  ON crm_staff(department) WHERE is_active = true;

-- =========================================================
-- ANALYZE — обновява статистиките за планировчика на PG
-- =========================================================
ANALYZE crm_cell_values;
ANALYZE crm_clients;
ANALYZE crm_audit_log;
ANALYZE crm_dropdown_options;


-- ===========================================================
-- >>> migration-016-realtime.sql
-- ===========================================================
-- Migration 016: Включва Realtime на ключовите таблици
--
-- Supabase Realtime праща събития при INSERT/UPDATE/DELETE на таблиците в
-- публикацията supabase_realtime. Frontend-ът слуша и тихо презарежда, така
-- че колегите виждат промените на живо без ръчен refresh.
--
-- RLS се спазва — събитие стига до клиент само ако той има SELECT право.
-- Нашите политики позволяват SELECT на authenticated, така че всичко е ОК.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'crm_cell_values',
    'crm_clients',
    'crm_monthly_work',
    'crm_art55_entries',
    'crm_art55_quarter_status',
    'crm_contacts',
    'crm_opportunities'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;


-- ===========================================================
-- >>> migration-017-master-flags.sql
-- ===========================================================
-- Migration 017: Master ДА/НЕ полета + месечни чекбоксове
--
-- 5 нови мастер dropdown колони (ДА/НЕ): АКЦИЗ, СТАТИСТИКА, Интрастат,
-- СИДДО, ОСС. Ако клиент е с „ДА" → в Работния лист излиза за чек.
--
-- 4 месечни чекбокса в crm_monthly_work (АКЦИЗ/СТАТИСТИКА/Интрастат/СИДДО).
-- ОСС е „сума на тримесечие" (като Чл.55) → обработва се в следваща
-- миграция (отделна таблица).

-- ============== 1. MASTER КОЛОНИ (ДА/НЕ) ==============
DO $$
DECLARE
  max_pos integer;
  col_id uuid;
  col_name text;
  names text[] := ARRAY['АКЦИЗ', 'СТАТИСТИКА', 'Интрастат', 'СИДДО', 'ОСС'];
BEGIN
  FOREACH col_name IN ARRAY names LOOP
    IF NOT EXISTS (SELECT 1 FROM crm_columns WHERE name = col_name) THEN
      SELECT COALESCE(MAX(position), -1) + 1 INTO max_pos FROM crm_columns;
      INSERT INTO crm_columns (name, type, position, is_required)
        VALUES (col_name, 'dropdown', max_pos, false)
        RETURNING id INTO col_id;
      INSERT INTO crm_dropdown_options (column_id, value, position) VALUES
        (col_id, 'НЕ', 0),
        (col_id, 'ДА', 1);
    END IF;
  END LOOP;
END $$;

-- ============== 2. МЕСЕЧНИ ЧЕКБОКСОВЕ ==============
ALTER TABLE crm_monthly_work ADD COLUMN IF NOT EXISTS akciz_done boolean NOT NULL DEFAULT false;
ALTER TABLE crm_monthly_work ADD COLUMN IF NOT EXISTS statistika_done boolean NOT NULL DEFAULT false;
ALTER TABLE crm_monthly_work ADD COLUMN IF NOT EXISTS intrastat_done boolean NOT NULL DEFAULT false;
ALTER TABLE crm_monthly_work ADD COLUMN IF NOT EXISTS siddo_done boolean NOT NULL DEFAULT false;


-- ===========================================================
-- >>> migration-018-oss-amount.sql
-- ===========================================================
-- Migration 018: ОСС месечна сума
--
-- ОСС се въвежда всеки месец (сума). На последния месец от тримесечието
-- (март/юни/септ/дек) в Работния лист се показва и сборът от трите месеца
-- = сумата за деклариране. Само за клиенти с мастер ОСС = ДА.

ALTER TABLE crm_monthly_work ADD COLUMN IF NOT EXISTS oss_amount numeric;


-- ===========================================================
-- >>> migration-019-trz.sql
-- ===========================================================
-- Migration 019: ТРЗ — мастер колона ТРЗ Софтуер
--
-- ТРЗ Софтуер (ОМЕКС/МИКРО) е постоянен атрибут на клиента → живее в
-- crm_columns / crm_cell_values (мастер), една стойност на клиент. Редактира
-- се от страница Клиенти.
--
-- ЗАБ.: ВЕДОМОСТ НЕ е тук — тя е месечна (виж migration-020-trz-monthly.sql).
--
-- Идемпотентно: пуска се повторно без грешка (като migration-017).

DO $$
DECLARE
  max_pos integer;
  col_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM crm_columns WHERE name = 'ТРЗ Софтуер') THEN
    SELECT COALESCE(MAX(position), -1) + 1 INTO max_pos FROM crm_columns;
    INSERT INTO crm_columns (name, type, position, is_required)
      VALUES ('ТРЗ Софтуер', 'dropdown', max_pos, false)
      RETURNING id INTO col_id;
    INSERT INTO crm_dropdown_options (column_id, value, position) VALUES
      (col_id, 'ОМЕКС', 0),
      (col_id, 'МИКРО', 1);
  END IF;
END $$;


-- ===========================================================
-- >>> migration-020-trz-monthly.sql
-- ===========================================================
-- Migration 020: ТРЗ месечен работен лист (crm_trz_work)
--
-- Един ред = (клиент × година × месец). Месечните полета се пълнят всеки месец
-- отначало — като crm_monthly_work. Постоянните атрибути (ТРЗ отговорник, ТРЗ
-- Статус, ТРЗ Софтуер) остават в мастер таблицата.
--
-- Полетата ще растат (на по-късен етап ще се добавят още чеклисти).

CREATE TABLE IF NOT EXISTS crm_trz_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE,
  year integer NOT NULL CHECK (year >= 2000 AND year <= 2100),
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),

  salaries_prepared boolean NOT NULL DEFAULT false,    -- Изготвени заплати
  insurance_submitted boolean NOT NULL DEFAULT false,  -- Подадени осигуровки
  insurance_submitted_at date,                         -- дата на подаване
  payroll_sent boolean NOT NULL DEFAULT false,         -- Изпратена ведомост
  payroll_sent_at date,                                -- дата на ведомостта

  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(client_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_trz_year_month ON crm_trz_work(year, month);
CREATE INDEX IF NOT EXISTS idx_trz_client ON crm_trz_work(client_id);

ALTER TABLE crm_trz_work ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trz_select" ON crm_trz_work;
CREATE POLICY "trz_select" ON crm_trz_work FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "trz_insert" ON crm_trz_work;
CREATE POLICY "trz_insert" ON crm_trz_work FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "trz_update" ON crm_trz_work;
CREATE POLICY "trz_update" ON crm_trz_work FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "trz_delete" ON crm_trz_work;
CREATE POLICY "trz_delete" ON crm_trz_work FOR DELETE TO authenticated USING (true);

-- Realtime (ако crm_* таблиците са в supabase_realtime публикацията)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_trz_work'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_trz_work;
  END IF;
END $$;

-- Почистване: ако стара 019 е създала МАСТЕР колона ВЕДОМОСТ (date), а още няма
-- въведени стойности — махаме я (вече е месечна, тук в crm_trz_work).
DO $$
DECLARE ved_id uuid;
BEGIN
  SELECT id INTO ved_id FROM crm_columns WHERE name = 'ВЕДОМОСТ' LIMIT 1;
  IF ved_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM crm_cell_values WHERE column_id = ved_id AND value_date IS NOT NULL
  ) THEN
    DELETE FROM crm_cell_values WHERE column_id = ved_id;
    DELETE FROM crm_columns WHERE id = ved_id;
  END IF;
END $$;


-- ===========================================================
-- >>> migration-022-trz-status.sql
-- ===========================================================
-- Migration 022: ТРЗ Статус (Активна / НЕ Активна) — контролира кои фирми
-- влизат в ТРЗ Работен лист. Всички съществуващи клиенти се маркират „Активна".
--
-- Идемпотентно: пуска се повторно без грешка.

DO $$
DECLARE
  col_id uuid;
  active_opt uuid;
  max_pos integer;
BEGIN
  -- Колоната (ако вече я има — преизползваме я)
  SELECT id INTO col_id FROM crm_columns WHERE name = 'ТРЗ Статус' LIMIT 1;
  IF col_id IS NULL THEN
    SELECT COALESCE(MAX(position), -1) + 1 INTO max_pos FROM crm_columns;
    INSERT INTO crm_columns (name, type, position, is_required)
      VALUES ('ТРЗ Статус', 'dropdown', max_pos, false)
      RETURNING id INTO col_id;
  END IF;

  -- Опции
  IF NOT EXISTS (SELECT 1 FROM crm_dropdown_options WHERE column_id = col_id AND value = 'Активна') THEN
    INSERT INTO crm_dropdown_options (column_id, value, position) VALUES (col_id, 'Активна', 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM crm_dropdown_options WHERE column_id = col_id AND value = 'НЕ Активна') THEN
    INSERT INTO crm_dropdown_options (column_id, value, position) VALUES (col_id, 'НЕ Активна', 1);
  END IF;

  SELECT id INTO active_opt FROM crm_dropdown_options WHERE column_id = col_id AND value = 'Активна' LIMIT 1;

  -- Всички клиенти без стойност за тази колона → „Активна"
  INSERT INTO crm_cell_values (client_id, column_id, value_dropdown)
    SELECT c.id, col_id, active_opt
    FROM crm_clients c
    WHERE NOT EXISTS (
      SELECT 1 FROM crm_cell_values cv WHERE cv.client_id = c.id AND cv.column_id = col_id
    );
END $$;


-- ===========================================================
-- >>> migration-023-rls-lockdown.sql
-- ===========================================================
-- ============================================================
-- Migration 023 — RLS Lockdown
-- ============================================================
-- Изравнява достъпа в базата с ролите от UI-то, за да не може
-- някой да заобиколи интерфейса през API-то (anon/authenticated ключ).
--
-- Роли:
--   admin    — пълен достъп навсякъде
--   manager  — редактира клиенти/контакти/тагове + работни листове
--   employee — чете клиенти/контакти; редактира само работни листове
--
-- Затворени дупки: политики с „using (true)" БЕЗ „to authenticated"
-- важаха за роля public → anon ключът имаше достъп. Тук всичко е
-- ограничено до authenticated + проверка на ролята.
--
-- Идемпотентно: drop if exists + create, пуска се повторно без грешка.
-- ============================================================

-- ------------------------------------------------------------
-- Helper: admin ИЛИ manager (security definer → без RLS рекурсия)
-- ------------------------------------------------------------
create or replace function is_current_user_admin_or_manager()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('admin', 'manager')
  );
$$;

-- ============================================================
-- crm_clients — четат всички логнати; пишат admin + manager
-- ============================================================
alter table crm_clients enable row level security;

drop policy if exists "clients_read_admin"    on crm_clients;
drop policy if exists "clients_read_employee" on crm_clients;
drop policy if exists "clients_insert"        on crm_clients;
drop policy if exists "clients_update"        on crm_clients;
drop policy if exists "clients_delete"        on crm_clients;
drop policy if exists "clients_select"        on crm_clients;
drop policy if exists "clients_write"         on crm_clients;

create policy "clients_select" on crm_clients
  for select to authenticated using (true);
create policy "clients_insert" on crm_clients
  for insert to authenticated with check (is_current_user_admin_or_manager());
create policy "clients_update" on crm_clients
  for update to authenticated using (is_current_user_admin_or_manager())
  with check (is_current_user_admin_or_manager());
create policy "clients_delete" on crm_clients
  for delete to authenticated using (is_current_user_admin_or_manager());

-- ============================================================
-- crm_cell_values — четат всички логнати; пишат admin + manager
-- ============================================================
alter table crm_cell_values enable row level security;

drop policy if exists "cell_values_select" on crm_cell_values;
drop policy if exists "cell_values_insert" on crm_cell_values;
drop policy if exists "cell_values_update" on crm_cell_values;
drop policy if exists "cell_values_delete" on crm_cell_values;

create policy "cell_values_select" on crm_cell_values
  for select to authenticated using (true);
create policy "cell_values_insert" on crm_cell_values
  for insert to authenticated with check (is_current_user_admin_or_manager());
create policy "cell_values_update" on crm_cell_values
  for update to authenticated using (is_current_user_admin_or_manager())
  with check (is_current_user_admin_or_manager());
create policy "cell_values_delete" on crm_cell_values
  for delete to authenticated using (is_current_user_admin_or_manager());

-- ============================================================
-- crm_columns — четат всички логнати; пише само admin
-- ============================================================
alter table crm_columns enable row level security;

drop policy if exists "columns_select" on crm_columns;
drop policy if exists "columns_write"  on crm_columns;

create policy "columns_select" on crm_columns
  for select to authenticated using (true);
create policy "columns_write" on crm_columns
  for all to authenticated
  using (is_current_user_admin())
  with check (is_current_user_admin());

-- ============================================================
-- crm_dropdown_options — четат всички логнати; пише само admin
-- ============================================================
alter table crm_dropdown_options enable row level security;

drop policy if exists "dropdown_options_select" on crm_dropdown_options;
drop policy if exists "dropdown_options_write"  on crm_dropdown_options;

create policy "dropdown_options_select" on crm_dropdown_options
  for select to authenticated using (true);
create policy "dropdown_options_write" on crm_dropdown_options
  for all to authenticated
  using (is_current_user_admin())
  with check (is_current_user_admin());

-- ============================================================
-- crm_tags / crm_client_tags — четат всички логнати; пишат admin + manager
-- (преди: read+write „true" за public → anon имаше пълен достъп)
-- ============================================================
alter table crm_tags enable row level security;

drop policy if exists "tags_read"   on crm_tags;
drop policy if exists "tags_write"  on crm_tags;
drop policy if exists "tags_select" on crm_tags;

create policy "tags_select" on crm_tags
  for select to authenticated using (true);
create policy "tags_write" on crm_tags
  for all to authenticated
  using (is_current_user_admin_or_manager())
  with check (is_current_user_admin_or_manager());

alter table crm_client_tags enable row level security;

drop policy if exists "client_tags_read"   on crm_client_tags;
drop policy if exists "client_tags_write"  on crm_client_tags;
drop policy if exists "client_tags_select" on crm_client_tags;

create policy "client_tags_select" on crm_client_tags
  for select to authenticated using (true);
create policy "client_tags_write" on crm_client_tags
  for all to authenticated
  using (is_current_user_admin_or_manager())
  with check (is_current_user_admin_or_manager());

-- ============================================================
-- crm_staff — четат всички логнати (dropdown-и теглят имена);
-- пише само admin. (преди: read важеше за public)
-- ============================================================
alter table crm_staff enable row level security;

drop policy if exists "staff_read"   on crm_staff;
drop policy if exists "staff_write"  on crm_staff;
drop policy if exists "staff_select" on crm_staff;

create policy "staff_select" on crm_staff
  for select to authenticated using (true);
create policy "staff_write" on crm_staff
  for all to authenticated
  using (is_current_user_admin())
  with check (is_current_user_admin());

-- ============================================================
-- crm_opportunities — само admin (UI-то е admin-only)
-- (преди: всеки authenticated имаше пълен достъп)
-- ============================================================
alter table crm_opportunities enable row level security;

drop policy if exists "opp_select" on crm_opportunities;
drop policy if exists "opp_insert" on crm_opportunities;
drop policy if exists "opp_update" on crm_opportunities;
drop policy if exists "opp_delete" on crm_opportunities;
drop policy if exists "opp_all"    on crm_opportunities;

create policy "opp_all" on crm_opportunities
  for all to authenticated
  using (is_current_user_admin())
  with check (is_current_user_admin());

-- ============================================================
-- crm_subscriptions — пропусната: таблицата не е създадена в базата
-- и приложението не я ползва (абонаментите се пазят през генеричните
-- колони / crm_cell_values). Ако някога се добави, се обезопасява тогава.
-- ============================================================

-- ============================================================
-- crm_expenses — само admin
-- (преди: „true" за public → anon имаше пълен достъп)
-- ============================================================
alter table crm_expenses enable row level security;

drop policy if exists "expenses_read"   on crm_expenses;
drop policy if exists "expenses_insert" on crm_expenses;
drop policy if exists "expenses_update" on crm_expenses;
drop policy if exists "expenses_delete" on crm_expenses;
drop policy if exists "expenses_all"    on crm_expenses;

create policy "expenses_all" on crm_expenses
  for all to authenticated
  using (is_current_user_admin())
  with check (is_current_user_admin());

-- ============================================================
-- crm_audit_log — чете само admin; всеки логнат може да вписва
-- (за логване на действията); без update/delete.
-- (преди: read+insert „true" за public → anon четеше дневника)
-- ============================================================
alter table crm_audit_log enable row level security;

drop policy if exists "audit_read"   on crm_audit_log;
drop policy if exists "audit_insert" on crm_audit_log;
drop policy if exists "audit_select" on crm_audit_log;

create policy "audit_select" on crm_audit_log
  for select to authenticated using (is_current_user_admin());
create policy "audit_insert" on crm_audit_log
  for insert to authenticated with check (true);


-- ===========================================================
-- >>> migration-024-user-views.sql
-- ===========================================================
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

