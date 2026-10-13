-- ============================================================
-- Migration 066 — подписите на клиентите: фирмата става водеща
-- ============================================================
-- Промяна в НАЧИНА НА ВЪВЕЖДАНЕ, не в данните. Досега се пишеше свободен
-- текст („Росица Диева (Флорета фешън)"), тоест името на фирмата се
-- преписваше на ръка при всеки нов подпис. Сега фирмата се ИЗБИРА от
-- Клиенти, а „Подпис" остава за ЧОВЕКА (собственика) — и се попълва сам
-- от `crm_contacts.owner_name`, ако го има.
--
-- ТРИ СЪСТОЯНИЯ, затова е нужно ново поле, а не само `client_id is null`:
--
--   client_id попълнен                  → подпис на наша фирма
--   client_id null + is_standalone=true → ИЗОЛИРАН СЛУЧАЙ (физ. лице или
--                                         фирма, която не обслужваме)
--   client_id null + is_standalone=false→ ЧАКА свързване
--
-- Без третото състояние 130-те внесени реда щяха да се четат като
-- „изолирани случаи", а те просто още не са свързани. Броячът „несвързани"
-- щеше да стане безсмислен точно когато трябва да се ползва.
--
-- `holder` става НЕЗАДЪЛЖИТЕЛЕН: при избрана фирма редът вече е разпознаваем
-- и собственикът може да не е известен. Разхлабване на ограничение е
-- безопасно — заварените редове всички имат стойност.
--
-- Идемпотентно.
-- ============================================================

alter table crm_client_certificates
  add column if not exists is_standalone boolean not null default false;

alter table crm_client_certificates
  alter column holder drop not null;

-- Ред без НИЩО, по което да се познае, е боклук. Фирма ИЛИ име —
-- поне едното. (Заварените 130 реда имат `holder`, тоест минават.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_client_certificates_identity_check'
  ) THEN
    ALTER TABLE crm_client_certificates
      ADD CONSTRAINT crm_client_certificates_identity_check
      CHECK (client_id IS NOT NULL OR holder IS NOT NULL);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
