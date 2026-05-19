-- Migration 015: Индекси за производителност
--
-- До сега имахме индекси само на новите таблици (monthly_work, art55,
-- opportunities). Тук добавяме индекси на горещите пътеки в основните
-- таблици (cell_values, clients, contacts, expenses, audit_log).
--
-- Очакван ефект: 50–500× по-бързи queries при данни > 1000 реда.
-- Без CONCURRENTLY — на малки таблици се случва под секунда, без локове.

-- =========================================================
-- crm_cell_values — НАЙ-горещата таблица
-- =========================================================
-- Заявки: WHERE client_id = X, WHERE column_id = Y, WHERE client_id AND column_id.
-- Композитният (client_id, column_id) покрива и единичните търсения по client_id.
CREATE INDEX IF NOT EXISTS idx_cells_client_col
  ON crm_cell_values(client_id, column_id);

CREATE INDEX IF NOT EXISTS idx_cells_col
  ON crm_cell_values(column_id);

-- =========================================================
-- crm_clients
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_clients_assigned
  ON crm_clients(assigned_to) WHERE deleted = false;

-- Soft-delete филтър — повечето заявки филтрират по deleted = false
CREATE INDEX IF NOT EXISTS idx_clients_not_deleted
  ON crm_clients(id) WHERE deleted = false;

-- =========================================================
-- crm_contacts
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_contacts_client
  ON crm_contacts(client_id);

-- =========================================================
-- crm_expenses
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_expenses_client
  ON crm_expenses(client_id);

CREATE INDEX IF NOT EXISTS idx_expenses_date
  ON crm_expenses(expense_date DESC);

-- =========================================================
-- crm_audit_log — рядко пишеме, често четем по дата/потребител
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_audit_created
  ON crm_audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_user_created
  ON crm_audit_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_action_created
  ON crm_audit_log(action, created_at DESC);

-- =========================================================
-- crm_dropdown_options — заявки винаги WHERE column_id = X
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_dropdown_col
  ON crm_dropdown_options(column_id);

-- =========================================================
-- crm_client_tags — many-to-many lookup
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_ctags_client
  ON crm_client_tags(client_id);

CREATE INDEX IF NOT EXISTS idx_ctags_tag
  ON crm_client_tags(tag_id);

-- =========================================================
-- crm_staff — by department
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_staff_department
  ON crm_staff(department) WHERE is_active = true;

-- =========================================================
-- ANALYZE — обновява статистиките за планировчика на PG
-- =========================================================
ANALYZE crm_cell_values;
ANALYZE crm_clients;
ANALYZE crm_contacts;
ANALYZE crm_expenses;
ANALYZE crm_audit_log;
ANALYZE crm_dropdown_options;
