-- ============================================================
-- Migration 025 — Личен чек лист (ДДС месечен чеклист)
-- ============================================================
-- Месечен чеклист на (клиент × година × месец) с 12 стъпки, разделени
-- на ПРОДАЖБИ (5) и ПОКУПКИ (7). Срок за ДДС: 14-ти на месеца.
--
-- Достъп: показва се на Счетоводители и Отговорници (филтрирано в UI по
-- зачислените им фирми). ТРЗ отделът не го вижда. Всички с достъп виждат
-- и редактират един и същ ред → промяната на счетоводителя е видима за
-- отговорника и обратно.
--
-- Идемпотентно: пуска се повторно без грешка.
-- ============================================================

create table if not exists crm_checklist (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  year int not null,
  month int not null,

  -- ПРОДАЖБИ
  check_clients          bool not null default false,  -- Проверка Клиенти
  check_invoice_numbers  bool not null default false,  -- Проверка № на ф-ри
  check_missing_invoices bool not null default false,  -- Проверка липсващи фактури
  spo                    bool not null default false,  -- СПО
  check_income           bool not null default false,  -- Проверка приход

  -- ПОКУПКИ
  check_suppliers        bool not null default false,  -- Проверка Доставчици
  otmyata                bool not null default false,  -- Отмята
  duplicate_invoices     bool not null default false,  -- Дублирани ф-ри
  rko                    bool not null default false,  -- РКО
  accounting_invoice     bool not null default false,  -- Фактура за счетоводно обслужване
  regular_invoices_art82 bool not null default false,  -- Регулярни ф-ри по чл.82
  check_unfinished_docs  bool not null default false,  -- Проверка незавършени документи

  notes text,

  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (client_id, year, month)
);

create index if not exists idx_checklist_period on crm_checklist(year, month);
create index if not exists idx_checklist_client on crm_checklist(client_id);

-- ============================================================
-- RLS — четат всички логнати; пишат admin/manager/employee.
-- (Филтрирането „само моите фирми" е в UI; редът е споделен между
-- счетоводител и отговорник по дизайн.)
-- ============================================================
alter table crm_checklist enable row level security;

drop policy if exists "checklist_select" on crm_checklist;
drop policy if exists "checklist_insert" on crm_checklist;
drop policy if exists "checklist_update" on crm_checklist;
drop policy if exists "checklist_delete" on crm_checklist;

create policy "checklist_select" on crm_checklist
  for select to authenticated using (true);
create policy "checklist_insert" on crm_checklist
  for insert to authenticated with check (true);
create policy "checklist_update" on crm_checklist
  for update to authenticated using (true) with check (true);
create policy "checklist_delete" on crm_checklist
  for delete to authenticated using (true);

-- Realtime (идемпотентно — добавя само ако още не е в публикацията)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_checklist'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_checklist;
  END IF;
END $$;
