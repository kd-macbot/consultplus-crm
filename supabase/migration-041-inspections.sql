-- ============================================================
-- Migration 041 — Проверки/Ревизии (върху crm_tasks)
-- ============================================================
-- Вместо нова таблица, задачите получават kind ('task' | 'inspection')
-- + inspection_type ('проверка' / 'ревизия' / 'ПФО' / 'насрещна' /
-- 'друго'). Табът „Проверки" на страницата Задачи филтрира по kind.
--
-- Отговорникът на проверката НЕ се пази тук — извлича се на живо от
-- колоната „Отговорник" на фирмата (crm_cell_values), така че винаги
-- е актуалният.
--
-- Съществуващите записи получават kind='task' (default) → нула регресия.
-- Идемпотентно.
-- ============================================================

alter table crm_tasks
  add column if not exists kind text not null default 'task',
  add column if not exists inspection_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_tasks_kind_check'
  ) THEN
    ALTER TABLE crm_tasks
      ADD CONSTRAINT crm_tasks_kind_check
      CHECK (kind IN ('task', 'inspection'));
  END IF;
END $$;

create index if not exists idx_tasks_kind on crm_tasks(kind);
