-- ============================================================
-- Migration 053 — Договори (изготвяне от шаблон)
-- ============================================================
-- Два обекта:
--   crm_contract_templates — шаблони на договори с placeholder-и
--     ({фирма}, {правна_форма}, {еик}, {адрес}, {управител}, {имейл},
--      {лице_за_контакт}, {хонорар}, {дата}, {в_сила_от} + латинските
--      {фирма_en}, {адрес_en}, {управител_en} за двуезичния вариант).
--     Редактируеми от админ без deploy — както при шаблоните за Съобщения.
--   crm_contracts — дневник на изготвените договори с ПЪЛЕН snapshot на
--     текста. Ако утре шаблонът се промени, вече изготвените договори си
--     остават четими такива, каквито са подписани.
--
-- client_name е snapshot — историята оцелява преименуване/триене на клиент.
-- fields (jsonb) пази попълнените стойности поотделно, за да може един
-- договор да бъде преиздаден/сверен без ново вадене от базата.
--
-- ДОСТЪП: само admin. Договорът съдържа месечния хонорар, а „Хонорар" е
-- admin-only навсякъде другаде (DataTable ADMIN_ONLY_COLUMNS, Excel експорт,
-- Табло). Разхлабването до мениджъри е смяна на helper функцията в двете
-- политики по-долу — но тогава хонорарът изтича към роля, която не го вижда.
--
-- Идемпотентно.
-- ============================================================

-- ---- Шаблони ---------------------------------------------------------
create table if not exists crm_contract_templates (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  body text not null,
  is_bilingual boolean not null default false,
  position double precision not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---- Изготвените договори -------------------------------------------
create table if not exists crm_contracts (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references crm_clients(id) on delete set null,
  client_name text not null,
  template_id uuid references crm_contract_templates(id) on delete set null,
  template_name text not null,
  contract_date date not null,
  effective_date date,
  monthly_fee numeric,
  body_snapshot text not null,
  fields jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contracts_created on crm_contracts(created_at desc);
create index if not exists idx_contracts_client on crm_contracts(client_id);

-- ---- RLS -------------------------------------------------------------
-- НОВА таблица = ВИНАГИ enable RLS + политики (само политики без enable =
-- публично отворена таблица).
alter table crm_contract_templates enable row level security;
alter table crm_contracts enable row level security;

drop policy if exists "contract_templates_all" on crm_contract_templates;
create policy "contract_templates_all" on crm_contract_templates
  for all to authenticated
  using (is_current_user_admin())
  with check (is_current_user_admin());

drop policy if exists "contracts_all" on crm_contracts;
create policy "contracts_all" on crm_contracts
  for all to authenticated
  using (is_current_user_admin())
  with check (is_current_user_admin());

-- ---- Стартов шаблон --------------------------------------------------
-- Текстът се вкарва от приложението при първо отваряне на страницата, ако
-- таблицата е празна (виж DEFAULT_CONTRACT_TEMPLATES в src/lib/contract.ts).
-- Тук не се seed-ва, за да не се дублира договорът на две места.

-- След ALTER/CREATE Supabase понякога не вижда новите таблици.
NOTIFY pgrst, 'reload schema';
