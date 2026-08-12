-- ============================================================
-- Migration 050 — Заключване на публично викаеми функции (Advisor)
-- ============================================================
-- Advisor-ът съобщава SECURITY DEFINER функции, викаеми през PostgREST RPC
-- от anon/authenticated. EXECUTE им е даден на роля PUBLIC (по подразбиране).
--
-- ⚠️ ВАЖНО (научено при първи опит): двете helper функции
--   is_current_user_admin() и is_current_user_admin_or_manager() СЕ ВИКАТ
--   при ЧЕТЕНЕ навсякъде — много таблици имат `FOR ALL` политики с
--   using(is_current_user_admin…), а FOR ALL важи и за SELECT. Ако им се
--   отнеме EXECUTE, четенето гърми (клиентите изчезват). Затова тях НЕ ги
--   пипаме — остават публично изпълними (безобидни: връщат само дали
--   ТЕКУЩИЯТ потребител е админ).
--
-- Заключваме само функции, които НЕ участват в нито една политика:
--   handle_new_user  — тригер (изпълнява се без проверка на EXECUTE)
--   rls_auto_enable  — поддръжка (не се вика през ролята на потребителя)
-- → напълно махаме публичния достъп.
--
-- Идемпотентно (regprocedure loop; прескача липсващи функции).
-- ============================================================

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('handle_new_user', 'rls_auto_enable')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);
  END LOOP;
END $$;
