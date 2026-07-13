-- ============================================================
-- Migration 040 — Задачи (опростен kanban / list)
-- ============================================================
-- Максимално прост task модел: заглавие, описание, 4 статуса
-- (todo / in_progress / done / issue), изпълнител от Персонал,
-- опционален клиент и срок.
--
-- Достъп: всички логнати виждат/местят всичко (малък екип,
-- прозрачност). Изтриване — създателят или admin (контрол в UI).
--
-- position — за подредба в kanban колоната (нови задачи в края).
--
-- Идемпотентно.
-- ============================================================

create table if not exists crm_tasks (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  status text not null default 'todo',
  assignee_staff_id uuid references crm_staff(id) on delete set null,
  client_id uuid references crm_clients(id) on delete set null,
  due_date date,
  position double precision not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- CHECK constraint за статуса (идемпотентно).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_tasks_status_check'
  ) THEN
    ALTER TABLE crm_tasks
      ADD CONSTRAINT crm_tasks_status_check
      CHECK (status IN ('todo', 'in_progress', 'done', 'issue'));
  END IF;
END $$;

create index if not exists idx_tasks_status on crm_tasks(status);
create index if not exists idx_tasks_assignee on crm_tasks(assignee_staff_id);

alter table crm_tasks enable row level security;

drop policy if exists "tasks_select" on crm_tasks;
drop policy if exists "tasks_insert" on crm_tasks;
drop policy if exists "tasks_update" on crm_tasks;
drop policy if exists "tasks_delete" on crm_tasks;

create policy "tasks_select" on crm_tasks for select to authenticated using (true);
create policy "tasks_insert" on crm_tasks for insert to authenticated with check (true);
create policy "tasks_update" on crm_tasks for update to authenticated using (true) with check (true);
create policy "tasks_delete" on crm_tasks for delete to authenticated using (true);

-- Realtime (идемпотентно)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_tasks;
  END IF;
END $$;
