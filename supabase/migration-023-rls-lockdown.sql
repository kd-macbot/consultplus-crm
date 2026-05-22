-- ============================================================
-- Migration 023 — RLS Lockdown
-- ============================================================
-- Изравнява достъпа в базата с ролите от UI-то, за да не може
-- някой да заобиколи интерфейса през API-то (anon/authenticated ключ).
--
-- Роли:
--   admin    — пълен достъп навсякъде
--   manager  — редактира клиенти/контакти/тагове + работни листове
--   employee — чете клиенти/контакти; редактира само работни листове
--
-- Затворени дупки: политики с „using (true)" БЕЗ „to authenticated"
-- важаха за роля public → anon ключът имаше достъп. Тук всичко е
-- ограничено до authenticated + проверка на ролята.
--
-- Идемпотентно: drop if exists + create, пуска се повторно без грешка.
-- ============================================================

-- ------------------------------------------------------------
-- Helper: admin ИЛИ manager (security definer → без RLS рекурсия)
-- ------------------------------------------------------------
create or replace function is_current_user_admin_or_manager()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('admin', 'manager')
  );
$$;

-- ============================================================
-- crm_clients — четат всички логнати; пишат admin + manager
-- ============================================================
alter table crm_clients enable row level security;

drop policy if exists "clients_read_admin"    on crm_clients;
drop policy if exists "clients_read_employee" on crm_clients;
drop policy if exists "clients_insert"        on crm_clients;
drop policy if exists "clients_update"        on crm_clients;
drop policy if exists "clients_delete"        on crm_clients;
drop policy if exists "clients_select"        on crm_clients;
drop policy if exists "clients_write"         on crm_clients;

create policy "clients_select" on crm_clients
  for select to authenticated using (true);
create policy "clients_insert" on crm_clients
  for insert to authenticated with check (is_current_user_admin_or_manager());
create policy "clients_update" on crm_clients
  for update to authenticated using (is_current_user_admin_or_manager())
  with check (is_current_user_admin_or_manager());
create policy "clients_delete" on crm_clients
  for delete to authenticated using (is_current_user_admin_or_manager());

-- ============================================================
-- crm_cell_values — четат всички логнати; пишат admin + manager
-- ============================================================
alter table crm_cell_values enable row level security;

drop policy if exists "cell_values_select" on crm_cell_values;
drop policy if exists "cell_values_insert" on crm_cell_values;
drop policy if exists "cell_values_update" on crm_cell_values;
drop policy if exists "cell_values_delete" on crm_cell_values;

create policy "cell_values_select" on crm_cell_values
  for select to authenticated using (true);
create policy "cell_values_insert" on crm_cell_values
  for insert to authenticated with check (is_current_user_admin_or_manager());
create policy "cell_values_update" on crm_cell_values
  for update to authenticated using (is_current_user_admin_or_manager())
  with check (is_current_user_admin_or_manager());
create policy "cell_values_delete" on crm_cell_values
  for delete to authenticated using (is_current_user_admin_or_manager());

-- ============================================================
-- crm_columns — четат всички логнати; пише само admin
-- ============================================================
alter table crm_columns enable row level security;

drop policy if exists "columns_select" on crm_columns;
drop policy if exists "columns_write"  on crm_columns;

create policy "columns_select" on crm_columns
  for select to authenticated using (true);
create policy "columns_write" on crm_columns
  for all to authenticated
  using (is_current_user_admin())
  with check (is_current_user_admin());

-- ============================================================
-- crm_dropdown_options — четат всички логнати; пише само admin
-- ============================================================
alter table crm_dropdown_options enable row level security;

drop policy if exists "dropdown_options_select" on crm_dropdown_options;
drop policy if exists "dropdown_options_write"  on crm_dropdown_options;

create policy "dropdown_options_select" on crm_dropdown_options
  for select to authenticated using (true);
create policy "dropdown_options_write" on crm_dropdown_options
  for all to authenticated
  using (is_current_user_admin())
  with check (is_current_user_admin());

-- ============================================================
-- crm_tags / crm_client_tags — четат всички логнати; пишат admin + manager
-- (преди: read+write „true" за public → anon имаше пълен достъп)
-- ============================================================
alter table crm_tags enable row level security;

drop policy if exists "tags_read"   on crm_tags;
drop policy if exists "tags_write"  on crm_tags;
drop policy if exists "tags_select" on crm_tags;

create policy "tags_select" on crm_tags
  for select to authenticated using (true);
create policy "tags_write" on crm_tags
  for all to authenticated
  using (is_current_user_admin_or_manager())
  with check (is_current_user_admin_or_manager());

alter table crm_client_tags enable row level security;

drop policy if exists "client_tags_read"   on crm_client_tags;
drop policy if exists "client_tags_write"  on crm_client_tags;
drop policy if exists "client_tags_select" on crm_client_tags;

create policy "client_tags_select" on crm_client_tags
  for select to authenticated using (true);
create policy "client_tags_write" on crm_client_tags
  for all to authenticated
  using (is_current_user_admin_or_manager())
  with check (is_current_user_admin_or_manager());

-- ============================================================
-- crm_staff — четат всички логнати (dropdown-и теглят имена);
-- пише само admin. (преди: read важеше за public)
-- ============================================================
alter table crm_staff enable row level security;

drop policy if exists "staff_read"   on crm_staff;
drop policy if exists "staff_write"  on crm_staff;
drop policy if exists "staff_select" on crm_staff;

create policy "staff_select" on crm_staff
  for select to authenticated using (true);
create policy "staff_write" on crm_staff
  for all to authenticated
  using (is_current_user_admin())
  with check (is_current_user_admin());

-- ============================================================
-- crm_opportunities — само admin (UI-то е admin-only)
-- (преди: всеки authenticated имаше пълен достъп)
-- ============================================================
alter table crm_opportunities enable row level security;

drop policy if exists "opp_select" on crm_opportunities;
drop policy if exists "opp_insert" on crm_opportunities;
drop policy if exists "opp_update" on crm_opportunities;
drop policy if exists "opp_delete" on crm_opportunities;
drop policy if exists "opp_all"    on crm_opportunities;

create policy "opp_all" on crm_opportunities
  for all to authenticated
  using (is_current_user_admin())
  with check (is_current_user_admin());

-- ============================================================
-- crm_subscriptions — пропусната: таблицата не е създадена в базата
-- и приложението не я ползва (абонаментите се пазят през генеричните
-- колони / crm_cell_values). Ако някога се добави, се обезопасява тогава.
-- ============================================================

-- ============================================================
-- crm_expenses — само admin
-- (преди: „true" за public → anon имаше пълен достъп)
-- ============================================================
alter table crm_expenses enable row level security;

drop policy if exists "expenses_read"   on crm_expenses;
drop policy if exists "expenses_insert" on crm_expenses;
drop policy if exists "expenses_update" on crm_expenses;
drop policy if exists "expenses_delete" on crm_expenses;
drop policy if exists "expenses_all"    on crm_expenses;

create policy "expenses_all" on crm_expenses
  for all to authenticated
  using (is_current_user_admin())
  with check (is_current_user_admin());

-- ============================================================
-- crm_audit_log — чете само admin; всеки логнат може да вписва
-- (за логване на действията); без update/delete.
-- (преди: read+insert „true" за public → anon четеше дневника)
-- ============================================================
alter table crm_audit_log enable row level security;

drop policy if exists "audit_read"   on crm_audit_log;
drop policy if exists "audit_insert" on crm_audit_log;
drop policy if exists "audit_select" on crm_audit_log;

create policy "audit_select" on crm_audit_log
  for select to authenticated using (is_current_user_admin());
create policy "audit_insert" on crm_audit_log
  for insert to authenticated with check (true);
