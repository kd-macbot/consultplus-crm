-- Migration 019: ТРЗ — мастер колона ТРЗ Софтуер
--
-- ТРЗ Софтуер (ОМЕКС/МИКРО) е постоянен атрибут на клиента → живее в
-- crm_columns / crm_cell_values (мастер), една стойност на клиент. Редактира
-- се от страница Клиенти.
--
-- ЗАБ.: ВЕДОМОСТ НЕ е тук — тя е месечна (виж migration-020-trz-monthly.sql).
--
-- Идемпотентно: пуска се повторно без грешка (като migration-017).

DO $$
DECLARE
  max_pos integer;
  col_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM crm_columns WHERE name = 'ТРЗ Софтуер') THEN
    SELECT COALESCE(MAX(position), -1) + 1 INTO max_pos FROM crm_columns;
    INSERT INTO crm_columns (name, type, position, is_required)
      VALUES ('ТРЗ Софтуер', 'dropdown', max_pos, false)
      RETURNING id INTO col_id;
    INSERT INTO crm_dropdown_options (column_id, value, position) VALUES
      (col_id, 'ОМЕКС', 0),
      (col_id, 'МИКРО', 1);
  END IF;
END $$;
