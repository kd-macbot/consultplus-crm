-- Migration 013: Авансови вноски + чл. 55 ЗДДФЛ
--
-- 1. Два нови мастер колони (постоянни за клиент):
--    - Авансови вноски (НЕ / Месечни / Тримесечни)
--    - Чл. 55 ЗДДФЛ   (ДА / НЕ)
-- 2. Две нови месечни полета в crm_monthly_work:
--    - advance_payment_done  (отметка: платена/декларирана за този месец)
--    - art55_declared        (отметка: декларация чл.55 подадена за това тримесечие)
--
-- UI логика (frontend):
--   - „Месечни" авансови      → показват се всеки месец, винаги акцентирани
--   - „Тримесечни" авансови   → акцент в месеци 4, 7, 10 (срок 15-то на месеца)
--   - „чл. 55 = ДА"           → акцент в месеци 1, 4, 7, 10 (срок края на месеца)

-- ============== 1. MASTER КОЛОНИ ==============
DO $$
DECLARE
  max_pos integer;
  adv_col_id uuid;
  art55_col_id uuid;
BEGIN
  SELECT COALESCE(MAX(position), -1) INTO max_pos FROM crm_columns;

  -- Авансови вноски
  IF NOT EXISTS (SELECT 1 FROM crm_columns WHERE name = 'Авансови вноски') THEN
    max_pos := max_pos + 1;
    INSERT INTO crm_columns (name, type, position, is_required)
      VALUES ('Авансови вноски', 'dropdown', max_pos, false)
      RETURNING id INTO adv_col_id;

    INSERT INTO crm_dropdown_options (column_id, value, position) VALUES
      (adv_col_id, 'НЕ', 0),
      (adv_col_id, 'Месечни', 1),
      (adv_col_id, 'Тримесечни', 2);
  END IF;

  -- Чл. 55 ЗДДФЛ
  IF NOT EXISTS (SELECT 1 FROM crm_columns WHERE name = 'Чл. 55 ЗДДФЛ') THEN
    max_pos := max_pos + 1;
    INSERT INTO crm_columns (name, type, position, is_required)
      VALUES ('Чл. 55 ЗДДФЛ', 'dropdown', max_pos, false)
      RETURNING id INTO art55_col_id;

    INSERT INTO crm_dropdown_options (column_id, value, position) VALUES
      (art55_col_id, 'НЕ', 0),
      (art55_col_id, 'ДА', 1);
  END IF;
END $$;

-- ============== 2. МЕСЕЧНИ ПОЛЕТА ==============
ALTER TABLE crm_monthly_work
  ADD COLUMN IF NOT EXISTS advance_payment_done boolean NOT NULL DEFAULT false;

ALTER TABLE crm_monthly_work
  ADD COLUMN IF NOT EXISTS art55_declared boolean NOT NULL DEFAULT false;
