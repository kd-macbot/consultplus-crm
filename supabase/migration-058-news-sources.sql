-- ============================================================
-- Migration 058 — Новини от бранша (автоматични, от RSS)
-- ============================================================
-- Всяка делнична сутрин edge функцията news-fetch чете настроените
-- феедове и добавя няколко новини в crm_news с флаг is_auto.
--
-- ЗАЩО РАЗДЕЛЕНИ ОТ НОВИНИТЕ НА ЕКИПА: лентата тегли 30 записа и
-- показва непиннатите 5 дни. При 4 автоматични на ден за пет дни се
-- трупат 20 — обявленията на колегите (заради които лентата
-- съществува) щяха да потънат. Затова `is_auto` дели двата потока и
-- UI-ът ги показва в отделни блокове.
--
-- ⚠️ НИКАКЪВ ПРЕРАЗКАЗ. Пази се заглавието и резюмето ТАКА, КАКТО ги
-- дава източникът, плюс линк към оригинала. Счетоводна новина, минала
-- през преразказ, е задължение — сгрешен срок или ставка стига да
-- подведе колега, който го прилага на клиент.
--
-- source_url (линкът към оригинала) е УНИКАЛЕН → една новина не влиза
-- два пъти, колкото и пъти да се пусне четенето.
--
-- Идемпотентно.
-- ============================================================

-- ---------- Извори ----------
create table if not exists crm_news_sources (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  -- Адресът, който човек би отворил. Функцията сама открива фееда в
  -- <link rel="alternate" type="application/rss+xml"> — не се иска
  -- потребителят да знае къде се крие.
  url text not null,
  -- Откритият (или подаден направо) феед. Пълни се от „Провери".
  feed_url text,
  enabled boolean not null default true,
  -- Колко новини най-много от ТОЗИ извор на едно пускане — за да не
  -- залее един бъбрив сайт цялата лента.
  max_per_run int not null default 2,

  -- Диагностика: кога за последно е четено успешно и кога е излязла
  -- най-новата видяна новина. „От N дни нищо оттук" е сигнал за счупен
  -- извор — иначе мълчи и никой не разбира.
  last_ok_at timestamptz,
  last_item_at timestamptz,
  last_error text,

  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Настройки (единичен ред) ----------
create table if not exists crm_news_settings (
  id boolean primary key default true,
  -- Главният ключ стартира ИЗКЛЮЧЕН — нищо не тръгва само, докато
  -- изворите не са проверени.
  enabled boolean not null default false,
  -- Общ таван на новините за едно пускане.
  max_per_run int not null default 4,
  updated_at timestamptz not null default now(),
  constraint crm_news_settings_single check (id)
);

insert into crm_news_settings (id) values (true) on conflict (id) do nothing;

-- ---------- Полета в самите новини ----------
alter table crm_news add column if not exists is_auto boolean not null default false;
alter table crm_news add column if not exists source_name text;
alter table crm_news add column if not exists source_url text;

-- Сърцето на защитата от дублиране: един линк = една новина.
create unique index if not exists idx_news_source_url
  on crm_news(source_url) where source_url is not null;
create index if not exists idx_news_auto_created
  on crm_news(is_auto, created_at desc);

-- ---------- RLS ----------
-- Изворите се управляват от същите хора, които пишат новини:
-- admin + мениджъри от „Управление". Самите новини се четат от всички
-- (политиките на crm_news не се пипат).
alter table crm_news_sources enable row level security;
alter table crm_news_settings enable row level security;

drop policy if exists "news_sources_all" on crm_news_sources;
create policy "news_sources_all" on crm_news_sources
  for all to authenticated
  using (is_current_user_admin() or is_current_user_management())
  with check (is_current_user_admin() or is_current_user_management());

drop policy if exists "news_settings_select" on crm_news_settings;
drop policy if exists "news_settings_update" on crm_news_settings;
create policy "news_settings_select" on crm_news_settings
  for select to authenticated using (is_current_user_admin() or is_current_user_management());
create policy "news_settings_update" on crm_news_settings
  for update to authenticated
  using (is_current_user_admin() or is_current_user_management())
  with check (is_current_user_admin() or is_current_user_management());

NOTIFY pgrst, 'reload schema';
