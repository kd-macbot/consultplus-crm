-- ============================================================
-- Migration 063 — хонорарът се стяга и в БАЗАТА
-- ============================================================
-- Досега стойността на колоната „Хонорар" живее в crm_cell_values, чиято
-- политика за четене е `using (true)` за ВСИЧКИ логнати. Скриването беше САМО
-- в интерфейса (таблицата Клиенти, Excel експортът, Картата на клиента), тоест
-- колега с достъп до системата можеше да прочете сумата извън приложението.
--
-- КОЙ ТРЯБВА ДА Я ЧЕТЕ (проверено в кода, не по памет):
--   admin                       — Табло, Абонаменти, Клиенти, Карта на клиента
--   мениджър от „Управление"    — Шаблони: хонорарът влиза В ДОГОВОРА
--                                 (Contracts.tsx: fee: resolveNumber(...))
-- Ако политиката пуснеше само admin, договорите на колегата от Управление щяха
-- да излизат с ПРАЗНА сума — тихо, защото документът се генерира без грешка.
--
-- ФОРМУЛИРОВКАТА Е `not in`, А НЕ `<> (подзаявка)`:
-- при `column_id <> (select ...)` липсваща колона „Хонорар" би дала NULL,
-- сравнението става NULL и политиката би скрила ВСИЧКИ клетки. С `not in`
-- празната подзаявка дава TRUE, тоест нищо не се чупи.
--
-- Подзаявката е несвързана (uncorrelated) → Postgres я смята ВЕДНЪЖ и я
-- хешира; crm_columns е ~21 реда.
--
-- ЗАПИСЪТ НЕ СЕ ПИПА: остава `is_current_user_admin_or_manager()`, както е за
-- всички клетки. Стягането на записа е отделно решение.
--
-- Идемпотентно.
-- ============================================================

drop policy if exists "cell_values_select" on crm_cell_values;

create policy "cell_values_select" on crm_cell_values
  for select to authenticated
  using (
    column_id not in (select id from crm_columns where name = 'Хонорар')
    or is_current_user_admin()
    or is_current_user_management()
  );

-- Политиката вика двата helper-а при SELECT → правата им НЕ се отнемат.
-- (Урок от миграция 050: REVOKE от helper счупи четенето на Клиенти.)
grant execute on function is_current_user_admin() to authenticated;
grant execute on function is_current_user_management() to authenticated;

NOTIFY pgrst, 'reload schema';
