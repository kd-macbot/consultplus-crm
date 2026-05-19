-- Migration 014: Авансови вноски + Чл. 55 — суми и тримесечни статуси
--
-- Промени спрямо MVP-то от Migration 013:
-- 1. Авансовите минават от чекбокс → числово поле "сума"
-- 2. Чл. 55 от чекбокс → 1-към-много entries (gross / tax / тип) на месец
-- 3. Чл. 55 декларацията е тримесечна → отделна таблица за status
-- 4. Нова мастер числова колона: „Аванс. — мин. годишна сума"

-- ============== 1. crm_monthly_work — добавя amount, дроп checkbox-ите ==============
ALTER TABLE crm_monthly_work
  ADD COLUMN IF NOT EXISTS advance_payment_amount numeric(12, 2);

-- Дропваме старите boolean-и (от 013-та). Никакви данни не са въвеждани още
-- (новата фийчъра е току що пусната) → безопасно е.
ALTER TABLE crm_monthly_work DROP COLUMN IF EXISTS advance_payment_done;
ALTER TABLE crm_monthly_work DROP COLUMN IF EXISTS art55_declared;

-- ============== 2. crm_art55_entries — множествени записи на месец ==============
CREATE TABLE IF NOT EXISTS crm_art55_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE,
  year integer NOT NULL CHECK (year >= 2000 AND year <= 2100),
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),

  gross_amount numeric(12, 2) NOT NULL DEFAULT 0,
  tax_amount numeric(12, 2) NOT NULL DEFAULT 0,
  income_type text,  -- 'дивидент' | 'наем' | 'лихва' | 'друго'

  position integer NOT NULL DEFAULT 0,  -- подреждане в рамките на месеца
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_art55_client_period ON crm_art55_entries(client_id, year, month);

ALTER TABLE crm_art55_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "art55_select" ON crm_art55_entries;
CREATE POLICY "art55_select" ON crm_art55_entries FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "art55_insert" ON crm_art55_entries;
CREATE POLICY "art55_insert" ON crm_art55_entries FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "art55_update" ON crm_art55_entries;
CREATE POLICY "art55_update" ON crm_art55_entries FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "art55_delete" ON crm_art55_entries;
CREATE POLICY "art55_delete" ON crm_art55_entries FOR DELETE TO authenticated USING (true);

-- ============== 3. crm_art55_quarter_status — тримесечен статус ==============
CREATE TABLE IF NOT EXISTS crm_art55_quarter_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE,
  year integer NOT NULL CHECK (year >= 2000 AND year <= 2100),
  quarter integer NOT NULL CHECK (quarter >= 1 AND quarter <= 4),

  declared boolean NOT NULL DEFAULT false,        -- ОК / x
  notification_method text,                       -- слак / мейл / тел / друго
  declared_at date,
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(client_id, year, quarter)
);
CREATE INDEX IF NOT EXISTS idx_art55q_year_quarter ON crm_art55_quarter_status(year, quarter);

ALTER TABLE crm_art55_quarter_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "art55q_select" ON crm_art55_quarter_status;
CREATE POLICY "art55q_select" ON crm_art55_quarter_status FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "art55q_insert" ON crm_art55_quarter_status;
CREATE POLICY "art55q_insert" ON crm_art55_quarter_status FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "art55q_update" ON crm_art55_quarter_status;
CREATE POLICY "art55q_update" ON crm_art55_quarter_status FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "art55q_delete" ON crm_art55_quarter_status;
CREATE POLICY "art55q_delete" ON crm_art55_quarter_status FOR DELETE TO authenticated USING (true);

-- ============== 4. Мастер „Аванс. — мин. годишна сума" ==============
DO $$
DECLARE
  max_pos integer;
BEGIN
  SELECT COALESCE(MAX(position), -1) INTO max_pos FROM crm_columns;
  IF NOT EXISTS (SELECT 1 FROM crm_columns WHERE name = 'Аванс. мин. годишна сума') THEN
    INSERT INTO crm_columns (name, type, position, is_required)
      VALUES ('Аванс. мин. годишна сума', 'number', max_pos + 1, false);
  END IF;
END $$;
