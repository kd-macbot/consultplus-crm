-- ============================================================
-- Migration 050 — Заключване на SECURITY DEFINER функции (Advisor)
-- ============================================================
-- Advisor-ът съобщава, че четири SECURITY DEFINER функции са викаеми през
-- PostgREST RPC от anon/authenticated. Причината: EXECUTE е даден на роля
-- PUBLIC (по подразбиране при create function). Migration 049 отне правата
-- от anon/authenticated поотделно, но PUBLIC ги надделява → warning-ите
-- останаха. Тук отнемаме от PUBLIC.
--
-- handle_new_user / rls_auto_enable — НЕ бива да са публично викаеми.
--   Тригерът (handle_new_user) и поддръжката (rls_auto_enable) се изпълняват
--   в собствен контекст, не през ролята на потребителя → пълно заключване.
-- is_current_user_admin(_or_manager) — НУЖНИ са в RLS политиките, оценявани
--   като authenticated. Затова: махаме от PUBLIC/anon, но ГРАНТваме обратно
--   на authenticated (иначе се чупи писането в клиентските таблици).
--   Безобидни са — връщат само дали ТЕКУЩИЯТ потребител е админ.
--
-- Идемпотентно (regprocedure loop — работи независимо от сигнатурата;
-- прескача функции, които липсват).
-- ============================================================

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('handle_new_user', 'rls_auto_enable', 'is_current_user_admin', 'is_current_user_admin_or_manager')
  LOOP
    -- Отнемаме публичния достъп изцяло.
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);

    -- Helper-ите за RLS трябва да останат изпълними за authenticated.
    IF r.proname IN ('is_current_user_admin', 'is_current_user_admin_or_manager') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
  END LOOP;
END $$;
