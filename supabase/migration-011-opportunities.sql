-- Migration 011: Opportunities (потенциални клиенти / sales pipeline)

CREATE TABLE IF NOT EXISTS crm_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Идентификация (същата структура като контактите за лесна миграция)
  name text NOT NULL,
  eik text,
  vat_number text,
  vat_registered_at date,
  address text,
  public_url text,
  owner_name_legal text,        -- собственик (физ. лице) от регистъра
  manager_name_legal text,      -- управляващ (физ. лице) от регистъра

  -- Pipeline
  stage text NOT NULL DEFAULT 'Нов',
  estimated_value numeric(12, 2),
  source text,

  -- Отговорник в нашата компания (имена като в Клиенти, ползва се staff_department)
  responsible text,

  -- Follow-up
  next_action text,
  next_action_date date,

  -- Контактни данни на потенциалния клиент
  contact_person text,
  contact_phone text,
  contact_email text,

  -- State + история
  notes text,
  lost_reason text,
  converted_to_client_id uuid REFERENCES crm_clients(id) ON DELETE SET NULL,
  converted_at timestamptz,

  -- Audit
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_opp_stage ON crm_opportunities(stage) WHERE deleted = false;
CREATE INDEX IF NOT EXISTS idx_opp_next_action ON crm_opportunities(next_action_date) WHERE deleted = false;
CREATE INDEX IF NOT EXISTS idx_opp_responsible ON crm_opportunities(responsible) WHERE deleted = false;

-- RLS — всички authenticated виждат и редактират (като клиентите)
ALTER TABLE crm_opportunities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "opp_select" ON crm_opportunities;
CREATE POLICY "opp_select" ON crm_opportunities FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "opp_insert" ON crm_opportunities;
CREATE POLICY "opp_insert" ON crm_opportunities FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "opp_update" ON crm_opportunities;
CREATE POLICY "opp_update" ON crm_opportunities FOR UPDATE TO authenticated USING (true);
