-- ============================================================
-- Migration 061 — Касови апарати „с разбивка"
-- ============================================================
-- Досега фактурите в брой, КИ и другите фискализирани документи се
-- въвеждат на ниво ФИРМА — един ред за месеца, независимо колко апарата
-- има. Някои фирми искат СПО по АПАРАТ, тоест същите пера да се въвеждат
-- при всеки апарат, а фирменият ред да е само сбор.
--
-- РЕЖИМЪТ Е ПО ФИРМА, не по апарат: смесване би позволило една и съща
-- фактура да влезе и на двете места и да се извади два пъти от СПО — тихо,
-- а числото отива в НАП. Затова видът се определя от ПЪРВИЯ добавен апарат
-- и всички следващи го наследяват. Смяна = изтриване на всички апарати и
-- добавяне наново (решение на потребителя).
--
-- Заварените фирми остават с 'simple' — нищо не се променя за тях.
--
-- Перата се добавят към СЪЩЕСТВУВАЩАТА таблица за оборота (апарат × месец),
-- а не в нова: така четенето, записът и уникалният ключ остават един.
--
-- Идемпотентно.
-- ============================================================

alter table crm_cash_registers
  add column if not exists kind text not null default 'simple';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_cash_registers_kind_check') THEN
    ALTER TABLE crm_cash_registers
      ADD CONSTRAINT crm_cash_registers_kind_check CHECK (kind IN ('simple', 'detailed'));
  END IF;
END $$;

alter table crm_cash_register_turnover
  add column if not exists invoices_cash_20 numeric not null default 0,
  add column if not exists invoices_cash_9  numeric not null default 0,
  add column if not exists credit_note_20   numeric not null default 0,
  add column if not exists credit_note_9    numeric not null default 0,
  add column if not exists other_fiscal_20  numeric not null default 0,
  add column if not exists other_fiscal_9   numeric not null default 0;

NOTIFY pgrst, 'reload schema';
