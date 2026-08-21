-- ============================================================
-- Migration 056 — Известия по имейл до служителите
-- ============================================================
-- Три обекта:
--   crm_notification_settings — ЕДИН ред с настройките (главен ключ,
--     кои напомняния са включени, на кои дати). Стартира ИЗКЛЮЧЕН —
--     нищо не тръгва само, докато админ не го пусне от UI.
--   crm_notifications — дневник на изпратеното: до кого, какво, кога,
--     дали е минало. И автоматичните, и ръчните писма минават оттук.
--   crm_staff.notify_email — отказ от известия за конкретен колега.
--
-- Самото изпращане минава през Edge Function mail-send (Resend API key
-- като secret). Cron-ът (GitHub Action) вика същата функция с action=run.
--
-- ЗАЩИТА ОТ ДУБЛИРАНЕ: dedupe_key + УНИКАЛЕН индекс. Редът се записва
-- ПРЕДИ изпращането (status='pending'), после се маркира sent/error.
-- При грешка dedupe_key се ЗАНУЛЯВА → следващото пускане пробва пак.
-- Така двойно пуснат cron не праща втори път, но провалът не блокира.
--
-- ДОСТЪП: само admin (route + гейт в страницата + RLS). Едно писмо
-- изброява чуждите задачи/фирми — не е за всички очи. Edge функцията
-- пише със service role и заобикаля RLS.
--
-- Идемпотентно.
-- ============================================================

-- ---------- Настройки (единичен ред) ----------
create table if not exists crm_notification_settings (
  id boolean primary key default true,
  -- ГЛАВЕН ключ. false = нищо не се изпраща автоматично, каквото и да
  -- е включено по-долу. Нарочно false по подразбиране.
  enabled boolean not null default false,

  -- Напомняне за задачи (дневен обзор до изпълнителя).
  tasks_enabled boolean not null default true,
  tasks_days_before int not null default 3,

  -- Напомняне за ДДС чек листа (срок 14-то число).
  checklist_enabled boolean not null default true,
  -- На кои дати от месеца да напомня. По подразбиране 3 дни преди
  -- срока и в деня преди него.
  checklist_days int[] not null default '{11,13}',

  -- Имейл за пробните писма от страницата „Известия".
  test_email text,

  updated_at timestamptz not null default now(),

  constraint crm_notification_settings_single check (id)
);

insert into crm_notification_settings (id) values (true)
  on conflict (id) do nothing;

-- ---------- Дневник ----------
create table if not exists crm_notifications (
  id uuid primary key default uuid_generate_v4(),
  -- 'task_due' | 'checklist_dds' | 'manual' | 'test'
  kind text not null,
  to_email text not null,
  to_name text,
  staff_id uuid references crm_staff(id) on delete set null,
  subject text not null,
  -- Текстовият вариант на писмото (за преглед в дневника). HTML-ът се
  -- пренася само до доставчика — тук би раздул таблицата без полза.
  body text not null,
  -- 'pending' (заявено) | 'sent' | 'error'
  status text not null default 'pending',
  error text,
  provider_id text,
  dedupe_key text,
  -- null = автоматично (cron); иначе кой е натиснал „Изпрати".
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_notifications_status_check'
  ) THEN
    ALTER TABLE crm_notifications
      ADD CONSTRAINT crm_notifications_status_check
      CHECK (status IN ('pending', 'sent', 'error'));
  END IF;
END $$;

-- Уникалността е СЪРЦЕТО на защитата от дублиране. Частичен индекс —
-- ръчните писма нямат ключ и не се ограничават.
create unique index if not exists idx_notifications_dedupe
  on crm_notifications(dedupe_key) where dedupe_key is not null;
create index if not exists idx_notifications_created
  on crm_notifications(created_at desc);

-- ---------- Отказ от известия по служител ----------
alter table crm_staff
  add column if not exists notify_email boolean not null default true;

-- ---------- RLS ----------
alter table crm_notification_settings enable row level security;
alter table crm_notifications enable row level security;

drop policy if exists "notif_settings_select" on crm_notification_settings;
drop policy if exists "notif_settings_update" on crm_notification_settings;
create policy "notif_settings_select" on crm_notification_settings
  for select to authenticated using (is_current_user_admin());
create policy "notif_settings_update" on crm_notification_settings
  for update to authenticated using (is_current_user_admin()) with check (is_current_user_admin());

drop policy if exists "notifications_select" on crm_notifications;
drop policy if exists "notifications_insert" on crm_notifications;
create policy "notifications_select" on crm_notifications
  for select to authenticated using (is_current_user_admin());
-- Вмъкването от UI минава през edge функцията (service role), но
-- политиката стои изрично — да не остане таблицата „отворена по
-- подразбиране", ако някога се пише директно.
create policy "notifications_insert" on crm_notifications
  for insert to authenticated with check (is_current_user_admin());

-- Схема кешът на PostgREST понякога не вижда новите колони веднага.
NOTIFY pgrst, 'reload schema';
