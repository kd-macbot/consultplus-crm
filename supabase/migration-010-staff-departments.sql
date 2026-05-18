-- Migration 010: свързване на колони с отдели + преименуване на „Заместване" → „Отговорник"
--
-- След като пуснеш този SQL:
-- • Колоната „Счетоводител" ще показва активни служители от отдел „Счетоводство"
-- • Колоната „Отговорник" (преди „Заместване") ще показва от „Тийм Лийд"
-- • Колоната „ТРЗ" ще показва от отдел „ТРЗ"
--
-- Старите ръчни dropdown стойности се мигрират към value_text, за да не се загубят.
-- Ако някое от имената не съвпада с активен служител — клетката ще се показва празна,
-- докато не я редактираш.

-- 1) Rename "Заместване" → "Отговорник"
UPDATE crm_columns
SET name = 'Отговорник'
WHERE name = 'Заместване';

-- 2) Migrate value_dropdown → value_text за всички cells в тези три колони
WITH target_cols AS (
  SELECT id FROM crm_columns WHERE name IN ('Счетоводител', 'Отговорник', 'ТРЗ')
)
UPDATE crm_cell_values cv
SET value_text = opt.value, value_dropdown = NULL
FROM crm_dropdown_options opt
WHERE cv.column_id IN (SELECT id FROM target_cols)
  AND cv.value_dropdown = opt.id;

-- 3) Свързване на колоните с отделите
UPDATE crm_columns SET staff_department = 'Счетоводство' WHERE name = 'Счетоводител';
UPDATE crm_columns SET staff_department = 'Тийм Лийд'    WHERE name = 'Отговорник';
UPDATE crm_columns SET staff_department = 'ТРЗ'          WHERE name = 'ТРЗ';
