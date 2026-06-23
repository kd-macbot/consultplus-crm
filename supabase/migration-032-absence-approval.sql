-- ============================================================
-- Migration 032 — Заявки за отпуска: одобрение от admin
-- ============================================================
-- Добавя workflow status + полета за одобрение/отказ. Само admin може
-- да одобрява (контрол в UI layer-а — RLS остава отворен, защото
-- staff таблицата има отделни роли).
--
-- Поведение:
--   - Служителят попълва заявка (status='pending')
--   - Admin я одобрява → status='approved', approved_by + approved_at се запълват
--   - Admin може и да я откаже → status='rejected', + rejection_reason
--   - Само одобрените се виждат от всички в календара. Чакащите/отказаните
--     се виждат от подателя и admin (филтриране в UI).
--
-- Съществуващите записи получават status='approved' (default) → нула
-- регресия. Идемпотентно.
-- ============================================================

alter table crm_absences
  add column if not exists status text not null default 'approved';

-- Add CHECK constraint if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_absences_status_check'
  ) THEN
    ALTER TABLE crm_absences
      ADD CONSTRAINT crm_absences_status_check
      CHECK (status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

alter table crm_absences
  add column if not exists rejection_reason text,
  add column if not exists approved_by uuid references profiles(id),
  add column if not exists approved_at timestamptz;

-- Бърз индекс за изброяване на чакащите.
create index if not exists idx_absences_pending on crm_absences(status) where status = 'pending';
