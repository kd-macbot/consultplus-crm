-- Migration 017: Master ДА/НЕ полета + месечни чекбоксове
--
-- 5 нови мастер dropdown колони (ДА/НЕ): АКЦИЗ, СТАТИСТИКА, Интрастат,
-- СИДДО, ОСС. Ако клиент е с „ДА" → в Работния лист излиза за чек.
--
-- 4 месечни чекбокса в crm_monthly_work (АКЦИЗ/СТАТИСТИКА/Интрастат/СИДДО).
-- ОСС е „сума на тримесечие" (като Чл.55) → обработва се в следваща
-- миграция (отделна таблица).

-- ============== 1. MASTER КОЛОНИ (ДА/НЕ) ==============
DO $$
DECLARE
  max_pos integer;
  col_id uuid;
  col_name text;
  names text[] := ARRAY['АКЦИЗ', 'СТАТИСТИКА', 'Интрастат', 'СИДДО', 'ОСС'];
BEGIN
  FOREACH col_name IN ARRAY names LOOP
    IF NOT EXISTS (SELECT 1 FROM crm_columns WHERE name = col_name) THEN
      SELECT COALESCE(MAX(position), -1) + 1 INTO max_pos FROM crm_columns;
      INSERT INTO crm_columns (name, type, position, is_required)
        VALUES (col_name, 'dropdown', max_pos, false)
        RETURNING id INTO col_id;
      INSERT INTO crm_dropdown_options (column_id, value, position) VALUES
        (col_id, 'НЕ', 0),
        (col_id, 'ДА', 1);
    END IF;
  END LOOP;
END $$;

-- ============== 2. МЕСЕЧНИ ЧЕКБОКСОВЕ ==============
ALTER TABLE crm_monthly_work ADD COLUMN IF NOT EXISTS akciz_done boolean NOT NULL DEFAULT false;
ALTER TABLE crm_monthly_work ADD COLUMN IF NOT EXISTS statistika_done boolean NOT NULL DEFAULT false;
ALTER TABLE crm_monthly_work ADD COLUMN IF NOT EXISTS intrastat_done boolean NOT NULL DEFAULT false;
ALTER TABLE crm_monthly_work ADD COLUMN IF NOT EXISTS siddo_done boolean NOT NULL DEFAULT false;
