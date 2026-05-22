-- Migration 020: ТРЗ месечен работен лист (crm_trz_work)
--
-- Един ред = (клиент × година × месец). Месечните полета се пълнят всеки месец
-- отначало — като crm_monthly_work. Постоянните атрибути (ТРЗ отговорник, ТРЗ
-- Статус, ТРЗ Софтуер) остават в мастер таблицата.
--
-- Полетата ще растат (на по-късен етап ще се добавят още чеклисти).

CREATE TABLE IF NOT EXISTS crm_trz_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE,
  year integer NOT NULL CHECK (year >= 2000 AND year <= 2100),
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),

  salaries_prepared boolean NOT NULL DEFAULT false,    -- Изготвени заплати
  insurance_submitted boolean NOT NULL DEFAULT false,  -- Подадени осигуровки
  insurance_submitted_at date,                         -- дата на подаване
  payroll_sent boolean NOT NULL DEFAULT false,         -- Изпратена ведомост
  payroll_sent_at date,                                -- дата на ведомостта

  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(client_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_trz_year_month ON crm_trz_work(year, month);
CREATE INDEX IF NOT EXISTS idx_trz_client ON crm_trz_work(client_id);

ALTER TABLE crm_trz_work ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trz_select" ON crm_trz_work;
CREATE POLICY "trz_select" ON crm_trz_work FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "trz_insert" ON crm_trz_work;
CREATE POLICY "trz_insert" ON crm_trz_work FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "trz_update" ON crm_trz_work;
CREATE POLICY "trz_update" ON crm_trz_work FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "trz_delete" ON crm_trz_work;
CREATE POLICY "trz_delete" ON crm_trz_work FOR DELETE TO authenticated USING (true);

-- Realtime (ако crm_* таблиците са в supabase_realtime публикацията)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_trz_work'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_trz_work;
  END IF;
END $$;

-- Почистване: ако стара 019 е създала МАСТЕР колона ВЕДОМОСТ (date), а още няма
-- въведени стойности — махаме я (вече е месечна, тук в crm_trz_work).
DO $$
DECLARE ved_id uuid;
BEGIN
  SELECT id INTO ved_id FROM crm_columns WHERE name = 'ВЕДОМОСТ' LIMIT 1;
  IF ved_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM crm_cell_values WHERE column_id = ved_id AND value_date IS NOT NULL
  ) THEN
    DELETE FROM crm_cell_values WHERE column_id = ved_id;
    DELETE FROM crm_columns WHERE id = ved_id;
  END IF;
END $$;
