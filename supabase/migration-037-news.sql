-- ============================================================
-- Migration 037 — Новини (под Календара)
-- ============================================================
-- Свободна лента с новини за екипа: обявления, нови клиенти, важни
-- неща за деня. Видими за всички; пишат admin + manager-Управление
-- (контрол в UI).
--
-- Името на автора се пази в самата таблица (denorm) — да не правим
-- join към profiles за всеки render.
--
-- Идемпотентно.
-- ============================================================

create table if not exists crm_news (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  body text,
  type text not null default 'general',
  pinned boolean not null default false,
  author_name text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_news_pinned_created on crm_news(pinned desc, created_at desc);

alter table crm_news enable row level security;

drop policy if exists "news_select" on crm_news;
drop policy if exists "news_insert" on crm_news;
drop policy if exists "news_update" on crm_news;
drop policy if exists "news_delete" on crm_news;

create policy "news_select" on crm_news for select to authenticated using (true);
create policy "news_insert" on crm_news for insert to authenticated with check (true);
create policy "news_update" on crm_news for update to authenticated using (true) with check (true);
create policy "news_delete" on crm_news for delete to authenticated using (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_news'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_news;
  END IF;
END $$;
