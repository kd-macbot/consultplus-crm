-- ============================================================
-- Migration 044 — Email на инспектора (ревизии/проверки)
-- ============================================================
-- Допълва 043: inspector_email в crm_tasks (само за kind='inspection').
-- Additive + идемпотентно.
-- ============================================================

alter table crm_tasks
  add column if not exists inspector_email text;

NOTIFY pgrst, 'reload schema';
