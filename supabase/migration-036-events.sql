-- ============================================================
-- Migration 036 — Фирмени събития (Календар)
-- ============================================================
-- Събития, които се виждат над списъка със служители в Календара —
-- тиймбилдинги, срещи, празници, обучения. Видими за всички, добавят
-- се само от admin.
--
-- Многодневни събития (start_date < end_date) → се рендерират като
-- band през всеки от дните. Часовете са незадължителни — ако са null
-- събитието е „целодневно".
--
-- Идемпотентно.
-- ============================================================

create table if not exists crm_events (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  start_date date not null,
  end_date date not null,
  start_time time,        -- ако null → all-day
  end_time time,
  type text not null default 'other',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists idx_events_period on crm_events(start_date, end_date);

alter table crm_events enable row level security;

drop policy if exists "events_select" on crm_events;
drop policy if exists "events_insert" on crm_events;
drop policy if exists "events_update" on crm_events;
drop policy if exists "events_delete" on crm_events;

create policy "events_select" on crm_events
  for select to authenticated using (true);
create policy "events_insert" on crm_events
  for insert to authenticated with check (true);
create policy "events_update" on crm_events
  for update to authenticated using (true) with check (true);
create policy "events_delete" on crm_events
  for delete to authenticated using (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_events;
  END IF;
END $$;
