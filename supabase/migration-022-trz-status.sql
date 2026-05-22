-- Migration 022: ТРЗ Статус (Активна / НЕ Активна) — контролира кои фирми
-- влизат в ТРЗ Работен лист. Всички съществуващи клиенти се маркират „Активна".
--
-- Идемпотентно: пуска се повторно без грешка.

DO $$
DECLARE
  col_id uuid;
  active_opt uuid;
  max_pos integer;
BEGIN
  -- Колоната (ако вече я има — преизползваме я)
  SELECT id INTO col_id FROM crm_columns WHERE name = 'ТРЗ Статус' LIMIT 1;
  IF col_id IS NULL THEN
    SELECT COALESCE(MAX(position), -1) + 1 INTO max_pos FROM crm_columns;
    INSERT INTO crm_columns (name, type, position, is_required)
      VALUES ('ТРЗ Статус', 'dropdown', max_pos, false)
      RETURNING id INTO col_id;
  END IF;

  -- Опции
  IF NOT EXISTS (SELECT 1 FROM crm_dropdown_options WHERE column_id = col_id AND value = 'Активна') THEN
    INSERT INTO crm_dropdown_options (column_id, value, position) VALUES (col_id, 'Активна', 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM crm_dropdown_options WHERE column_id = col_id AND value = 'НЕ Активна') THEN
    INSERT INTO crm_dropdown_options (column_id, value, position) VALUES (col_id, 'НЕ Активна', 1);
  END IF;

  SELECT id INTO active_opt FROM crm_dropdown_options WHERE column_id = col_id AND value = 'Активна' LIMIT 1;

  -- Всички клиенти без стойност за тази колона → „Активна"
  INSERT INTO crm_cell_values (client_id, column_id, value_dropdown)
    SELECT c.id, col_id, active_opt
    FROM crm_clients c
    WHERE NOT EXISTS (
      SELECT 1 FROM crm_cell_values cv WHERE cv.client_id = c.id AND cv.column_id = col_id
    );
END $$;
