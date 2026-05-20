-- Migration 016: Включва Realtime на ключовите таблици
--
-- Supabase Realtime праща събития при INSERT/UPDATE/DELETE на таблиците в
-- публикацията supabase_realtime. Frontend-ът слуша и тихо презарежда, така
-- че колегите виждат промените на живо без ръчен refresh.
--
-- RLS се спазва — събитие стига до клиент само ако той има SELECT право.
-- Нашите политики позволяват SELECT на authenticated, така че всичко е ОК.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'crm_cell_values',
    'crm_clients',
    'crm_monthly_work',
    'crm_art55_entries',
    'crm_art55_quarter_status',
    'crm_contacts',
    'crm_opportunities'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
