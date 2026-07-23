-- ============================================================
-- Migration 043 — Детайли по ревизии/проверки
-- ============================================================
-- Нови полета в crm_tasks (ползват се само при kind='inspection'):
--   inspector_name  — име на инспектора
--   inspector_phone — телефон за връзка с инспектора
--   documents_url   — линк към документите (папка/файл)
--
-- Съществуващото due_date при ревизиите се показва като
-- „Срок за предаване" — само етикет, без промяна по данните.
--
-- Additive + идемпотентно. Съществуващите записи не се пипат.
-- ============================================================

alter table crm_tasks
  add column if not exists inspector_name text,
  add column if not exists inspector_phone text,
  add column if not exists documents_url text;

-- Supabase понякога не вижда нови колони веднага след ALTER TABLE.
NOTIFY pgrst, 'reload schema';
