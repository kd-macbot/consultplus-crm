-- ============================================================
-- Migration 065 — Електронни подписи на КЛИЕНТИТЕ
-- ============================================================
-- ⚠️ ТОВА НЕ Е crm_certificates (мигр. 057). Двете са различни неща и
-- нарочно НЕ се сливат:
--
--   crm_certificates        — КЕП на КАНТОРАТА. Издадени на собственика,
--                             ЗАЧИСЛЯВАТ се на колеги, съдържат ПИН и ПУК,
--                             затова ги четат само admin + „Управление".
--   crm_client_certificates — КЕП на КЛИЕНТИТЕ (тази таблица). Нямат ПИН,
--                             връзват се с ФИРМА, и трябва да ги вижда
--                             всеки колега, който работи с фирмата.
--
-- Сливането щеше да изправи пред избор между две лоши: или клиентските
-- подписи се скриват от хората, на които трябват, или ПИН-овете на
-- кантората се отварят за всички.
--
-- ⚠️ СЕРИЙНИЯТ НОМЕР Е ТЕКСТ, НЕ ЧИСЛО — същият урок като при 057.
-- В изходния Excel 14 от 130 номера вече са невъзстановимо развалени
-- („4.00618634695147e+18"): точността се губи след 15-ата цифра.
-- Формата отказва научен запис (`looksLikeExcelFloat`).
--
-- ВРЪЗКАТА С ФИРМА Е ДОБРОВОЛНА (`client_id` може да е null). В Excel-а
-- колоната „Подпис" е свободен текст и смесва четири начина на запис:
--   „КОНСТРУКТ СТРОЙ ООД (ПАДАРЛИ КОМЕРС ЕООД)"
--   „ГЮРБЮЗ БЬОЛЕР /МИКС 24 ООД/"
--   „Калин Диев (Пропърти Хъб, Уеб Екс, Уеб Екс Софтуеър)"
-- Тоест един ред понякога покрива няколко фирми. Затова `holder` се пази
-- КАКТО Е и остава водещ, а връзката се прави на ръка от екрана.
-- Автоматично гадаене би сложило чужд подпис в картата на клиента, тихо.
--
-- Идемпотентно.
-- ============================================================

create table if not exists crm_client_certificates (
  id uuid primary key default uuid_generate_v4(),

  -- Текстът от таблицата: „Росица Диева (Флорета фешън)". ЗАДЪЛЖИТЕЛЕН —
  -- единственото, което със сигурност имаме за всеки ред.
  holder text not null,

  -- null = още не е свързан с фирма. Изрично НЕ е `on delete cascade`:
  -- махната фирма не бива да отнася историята на подписа.
  client_id uuid references crm_clients(id) on delete set null,

  -- 'professional' = фирмен (издаден на юридическото лице)
  -- 'personal'     = персонален (издаден на физическо лице)
  -- null = непопълнено (6 такива реда в изходния файл)
  cert_kind text,

  serial_number text,
  valid_to date,

  -- „Номер на заявката" от таблицата — следата към поръчката при доставчика.
  request_no text,
  notes text,
  -- „Бележки за Плащане" — отделна колона в таблицата и се ползва за друго
  -- (кой плаща, поръчано ли е подновяване), затова не се слива с `notes`.
  payment_notes text,

  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_client_certificates_kind_check'
  ) THEN
    ALTER TABLE crm_client_certificates
      ADD CONSTRAINT crm_client_certificates_kind_check
      CHECK (cert_kind IS NULL OR cert_kind IN ('professional', 'personal'));
  END IF;
END $$;

-- Справката е „кои изтичат" → индекс по датата; и „подписите на тази фирма".
create index if not exists idx_client_certs_valid_to on crm_client_certificates(valid_to);
create index if not exists idx_client_certs_client on crm_client_certificates(client_id);

alter table crm_client_certificates enable row level security;

-- ЧЕТАТ ВСИЧКИ логнати: счетоводителят трябва да знае кога изтича подписът
-- на неговата фирма. Няма ПИН, няма парола — няма какво да се пази.
drop policy if exists client_certs_select on crm_client_certificates;
create policy client_certs_select on crm_client_certificates
  for select to authenticated using (true);

-- ПИШАТ admin + „Управление" — същите, които получават напомнянията и
-- поръчват подновяването. ТРИ отделни политики, не една FOR ALL: FOR ALL
-- важи и за SELECT и би искала EXECUTE върху helper-а при всяко четене
-- (урокът от мигр. 050).
drop policy if exists client_certs_insert on crm_client_certificates;
create policy client_certs_insert on crm_client_certificates
  for insert to authenticated
  with check (is_current_user_admin() or is_current_user_management());

drop policy if exists client_certs_update on crm_client_certificates;
create policy client_certs_update on crm_client_certificates
  for update to authenticated
  using (is_current_user_admin() or is_current_user_management());

drop policy if exists client_certs_delete on crm_client_certificates;
create policy client_certs_delete on crm_client_certificates
  for delete to authenticated
  using (is_current_user_admin() or is_current_user_management());

-- ---------- Напомняне по имейл ----------
-- Отива при admin + „Управление" (решение на потребителя), на 30/20/7 дни
-- преди изтичане. Числата са поле, не константа — подновяването при
-- доставчик отнема различно време в различни години.
alter table crm_notification_settings
  add column if not exists client_certs_enabled boolean not null default true;
alter table crm_notification_settings
  add column if not exists client_certs_days int[] not null default '{30,20,7}';

-- Supabase понякога не вижда новите колони веднага.
NOTIFY pgrst, 'reload schema';
