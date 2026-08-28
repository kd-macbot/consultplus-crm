-- ============================================================
-- Migration 057 — Електронни подписи (КЕП) на колегите
-- ============================================================
-- Инвентар на квалифицираните електронни подписи: всички са издадени
-- на собственика на фирмата (Автор/CN) и се ЗАЧИСЛЯВАТ на колеги.
-- Подпис без зачислен колега е СВОБОДЕН (assigned_staff_id is null).
--
-- ⚠️ СЕРИЙНИЯТ НОМЕР Е ТЕКСТ, НЕ ЧИСЛО. Номерата са 19-цифрени, а
-- всяко числово поле (включително Excel) губи точност след 15-ата
-- цифра — в изходния файл половината номера бяха превърнати в
-- „2.64549302217344e+18" и оригиналът е невъзстановим. Затова тук
-- полето е text и UI-ът отказва научен запис.
--
-- ⚠️ ПИН и ПУК се пазят в чист текст, както паролите в Банков достъп.
-- Разликата е, че тук защитата НЕ е само в UI: RLS пуска само admin и
-- мениджър от отдел „Управление" (is_current_user_management от
-- миграция 054). Колега без тези права не може да прочете реда дори
-- да извика API-то директно.
--
-- Историята „кой кога е държал подписа" отива в crm_audit_log —
-- решение на потребителя (08.2026): смяната е рядка, а Дневникът вече
-- има търсене. Затова няма отделна таблица със зачислявания.
--
-- Идемпотентно.
-- ============================================================

create table if not exists crm_certificates (
  id uuid primary key default uuid_generate_v4(),

  -- Номерът на самото устройство („5", „8", „A") — както е изписан
  -- върху него. Текст, защото не всички са цифри.
  device_no text,

  -- Автор (CN) от сертификата — собственикът, на когото е издаден.
  owner_cn text,
  -- Тип на сертификата, напр. PersonalCertificate_QCQES.
  cert_type text,
  -- 19-цифрен номер → ЗАДЪЛЖИТЕЛНО текст (виж бележката горе).
  serial_number text,

  valid_from date,
  valid_to date,

  pin text,
  puk text,

  -- null = подписът е СВОБОДЕН.
  assigned_staff_id uuid references crm_staff(id) on delete set null,

  notes text,
  position double precision not null default 0,

  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_certificates_assignee on crm_certificates(assigned_staff_id);
create index if not exists idx_certificates_valid_to on crm_certificates(valid_to);

-- Един сериен номер = един подпис. Частичен индекс, защото редът може
-- да се създаде преди номерът да е известен.
create unique index if not exists idx_certificates_serial
  on crm_certificates(serial_number)
  where serial_number is not null and btrim(serial_number) <> '';

-- ---------- RLS ----------
-- Стегнато, не „using(true)": редът съдържа ПИН и ПУК на подпис на
-- собственика. Виждат го само admin и Управление — същият гейт като
-- при Шаблони (договорите съдържат хонорара).
alter table crm_certificates enable row level security;

drop policy if exists "certificates_all" on crm_certificates;
create policy "certificates_all" on crm_certificates
  for all to authenticated
  using (is_current_user_admin() or is_current_user_management())
  with check (is_current_user_admin() or is_current_user_management());

-- Realtime (идемпотентно) — двама души пишат в една таблица.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_certificates'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_certificates;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
