-- Migration 012: Monthly work sheet (месечен работен лист)
--
-- Един ред = (клиент × година × месец). Месечните полета (РЕЗУЛТАТ, ДДС ОСЧЕТ,
-- АМОР, БАНКА, ЗАПЛАТИ, …) се пълнят всеки месец отначало. Постоянните полета
-- остават в crm_columns / crm_cell_values (мастер).

CREATE TABLE IF NOT EXISTS crm_monthly_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE,
  year integer NOT NULL CHECK (year >= 2000 AND year <= 2100),
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),

  -- Counter accountant fields
  priority_vat boolean NOT NULL DEFAULT false,        -- „приоритетно подаване на ДДС"
  result_amount numeric(12, 2),                       -- РЕЗУЛТАТ €
  submitted_at date,                                  -- ПОДАДЕНО НА
  notification_method text,                           -- УВЕДОМЕНИ — Вайбър/Слак/Имейл/Друго
  npa_inconsistencies text,                           -- НЕСЪОТВЕТСТВИЯ НАП

  -- Checklist
  vat_accounted boolean NOT NULL DEFAULT false,       -- ДДС ОСЧЕТ
  amortization_done boolean NOT NULL DEFAULT false,   -- АМОР
  bank_done boolean NOT NULL DEFAULT false,           -- БАНКА
  salaries_done boolean NOT NULL DEFAULT false,       -- ЗАПЛАТИ

  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(client_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_mwork_year_month ON crm_monthly_work(year, month);
CREATE INDEX IF NOT EXISTS idx_mwork_client ON crm_monthly_work(client_id);

ALTER TABLE crm_monthly_work ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mwork_select" ON crm_monthly_work;
CREATE POLICY "mwork_select" ON crm_monthly_work FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "mwork_insert" ON crm_monthly_work;
CREATE POLICY "mwork_insert" ON crm_monthly_work FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "mwork_update" ON crm_monthly_work;
CREATE POLICY "mwork_update" ON crm_monthly_work FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "mwork_delete" ON crm_monthly_work;
CREATE POLICY "mwork_delete" ON crm_monthly_work FOR DELETE TO authenticated USING (true);
