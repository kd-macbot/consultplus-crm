-- ============================================================
-- Migration 051 — Касови апарати / СПО справки
-- ============================================================
-- За фирми с master колона „Касов апарат" = ДА. Всяка фирма има 1+ касови
-- апарата; за всеки апарат по месец се въвеждат оборот/сторно 20% и 9%.
-- На ниво фирма по месец: фактури в брой 20/9 + финансов отчет РЗОК (само
-- за аптеки, иначе празно). Общо / Чист оборот / СПО се смятат в UI.
--
-- СПО 20% = (Общо20 − Сторно20) − Фактури в брой 20% − РЗОК
-- СПО 9%  = (Общо9  − Сторно9)  − Фактури в брой 9%
--
-- Достъп: admin + мениджъри + Счетоводство (гейт в UI). RLS using(true)
-- за логнати — същият приет модел като останалите оперативни таблици.
--
-- Идемпотентно.
-- ============================================================

-- ---- Апаратите на фирма (Обект + Памет) ------------------------------
create table if not exists crm_cash_registers (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  object_name text,
  memory_number text,
  position double precision not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_cash_registers_client on crm_cash_registers(client_id);

-- ---- Месечен оборот по апарат ----------------------------------------
create table if not exists crm_cash_register_turnover (
  id uuid primary key default uuid_generate_v4(),
  register_id uuid not null references crm_cash_registers(id) on delete cascade,
  year int not null,
  month int not null,
  turnover_20 numeric not null default 0,
  storno_20 numeric not null default 0,
  turnover_9 numeric not null default 0,
  storno_9 numeric not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists idx_cash_turnover_reg on crm_cash_register_turnover(register_id);
create index if not exists idx_cash_turnover_period on crm_cash_register_turnover(year, month);

-- ---- Месечни данни на ниво фирма (фактури в брой, РЗОК) ---------------
create table if not exists crm_cash_firm_monthly (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  year int not null,
  month int not null,
  invoices_cash_20 numeric not null default 0,
  invoices_cash_9 numeric not null default 0,
  rzok numeric not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists idx_cash_firm_client on crm_cash_firm_monthly(client_id);

-- Уникалност (идемпотентно през DO блок).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_cash_turnover_uniq') THEN
    ALTER TABLE crm_cash_register_turnover
      ADD CONSTRAINT crm_cash_turnover_uniq UNIQUE (register_id, year, month);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_cash_firm_monthly_uniq') THEN
    ALTER TABLE crm_cash_firm_monthly
      ADD CONSTRAINT crm_cash_firm_monthly_uniq UNIQUE (client_id, year, month);
  END IF;
END $$;

-- ---- RLS ----
alter table crm_cash_registers enable row level security;
alter table crm_cash_register_turnover enable row level security;
alter table crm_cash_firm_monthly enable row level security;

drop policy if exists "cash_reg_select" on crm_cash_registers;
drop policy if exists "cash_reg_insert" on crm_cash_registers;
drop policy if exists "cash_reg_update" on crm_cash_registers;
drop policy if exists "cash_reg_delete" on crm_cash_registers;
create policy "cash_reg_select" on crm_cash_registers for select to authenticated using (true);
create policy "cash_reg_insert" on crm_cash_registers for insert to authenticated with check (true);
create policy "cash_reg_update" on crm_cash_registers for update to authenticated using (true) with check (true);
create policy "cash_reg_delete" on crm_cash_registers for delete to authenticated using (true);

drop policy if exists "cash_turn_select" on crm_cash_register_turnover;
drop policy if exists "cash_turn_insert" on crm_cash_register_turnover;
drop policy if exists "cash_turn_update" on crm_cash_register_turnover;
drop policy if exists "cash_turn_delete" on crm_cash_register_turnover;
create policy "cash_turn_select" on crm_cash_register_turnover for select to authenticated using (true);
create policy "cash_turn_insert" on crm_cash_register_turnover for insert to authenticated with check (true);
create policy "cash_turn_update" on crm_cash_register_turnover for update to authenticated using (true) with check (true);
create policy "cash_turn_delete" on crm_cash_register_turnover for delete to authenticated using (true);

drop policy if exists "cash_firm_select" on crm_cash_firm_monthly;
drop policy if exists "cash_firm_insert" on crm_cash_firm_monthly;
drop policy if exists "cash_firm_update" on crm_cash_firm_monthly;
create policy "cash_firm_select" on crm_cash_firm_monthly for select to authenticated using (true);
create policy "cash_firm_insert" on crm_cash_firm_monthly for insert to authenticated with check (true);
create policy "cash_firm_update" on crm_cash_firm_monthly for update to authenticated using (true) with check (true);

-- ---- Realtime (идемпотентно) ----
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_cash_registers','crm_cash_register_turnover','crm_cash_firm_monthly'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
