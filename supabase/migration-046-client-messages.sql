-- ============================================================
-- Migration 046 — Съобщения към клиенти (Mobica: Viber + SMS fallback)
-- ============================================================
-- Два обекта:
--   crm_message_templates — шаблони с placeholder-и ({фирма}, {месец},
--     {сума}, {срок}), редактируеми от админ без deploy
--   crm_client_messages — пълен дневник на изпратените съобщения:
--     какво, до кого, кога, от кого, какъв статус (DLR)
--
-- Самото изпращане минава през Edge Function mobica-send (credentials
-- като secrets). UI гейтва изпращането до admin/manager; служителите
-- виждат само историята.
--
-- client_name е snapshot — историята оцелява преименуване/триене на клиент.
-- idd е нашият уникален reference за DLR проверката (24ч прозорец).
--
-- Идемпотентно.
-- ============================================================

create table if not exists crm_message_templates (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  body text not null,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists crm_client_messages (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references crm_clients(id) on delete set null,
  client_name text not null,
  phone text not null,
  text text not null,
  sms_text text,
  idd text not null unique,
  tag text,
  status text not null default 'accepted',
  status_code text,
  status_desc text,
  delivered_channel text,
  date_report timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- CHECK constraint за статуса (идемпотентно).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_client_messages_status_check'
  ) THEN
    ALTER TABLE crm_client_messages
      ADD CONSTRAINT crm_client_messages_status_check
      CHECK (status IN ('accepted', 'rejected', 'delivered', 'undelivered', 'unknown', 'error'));
  END IF;
END $$;

create index if not exists idx_client_messages_created on crm_client_messages(created_at desc);
create index if not exists idx_client_messages_client on crm_client_messages(client_id);

alter table crm_message_templates enable row level security;
alter table crm_client_messages enable row level security;

drop policy if exists "msg_templates_select" on crm_message_templates;
drop policy if exists "msg_templates_insert" on crm_message_templates;
drop policy if exists "msg_templates_update" on crm_message_templates;
drop policy if exists "msg_templates_delete" on crm_message_templates;
create policy "msg_templates_select" on crm_message_templates for select to authenticated using (true);
create policy "msg_templates_insert" on crm_message_templates for insert to authenticated with check (true);
create policy "msg_templates_update" on crm_message_templates for update to authenticated using (true) with check (true);
create policy "msg_templates_delete" on crm_message_templates for delete to authenticated using (true);

drop policy if exists "client_messages_select" on crm_client_messages;
drop policy if exists "client_messages_insert" on crm_client_messages;
drop policy if exists "client_messages_update" on crm_client_messages;
create policy "client_messages_select" on crm_client_messages for select to authenticated using (true);
create policy "client_messages_insert" on crm_client_messages for insert to authenticated with check (true);
create policy "client_messages_update" on crm_client_messages for update to authenticated using (true) with check (true);
-- Без delete policy — дневникът не се трие.

-- Стартови шаблони (само ако липсват).
insert into crm_message_templates (name, body, position)
values
  ('ДДС за плащане', 'Здравейте, дължимият ДДС на {фирма} за {месец} е {сума}. Срок за плащане: {срок}. Поздрави, Консулт Плюс', 0),
  ('Свободен текст', 'Здравейте, ', 1)
on conflict (name) do nothing;

-- Realtime (идемпотентно)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_client_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_client_messages;
  END IF;
END $$;
