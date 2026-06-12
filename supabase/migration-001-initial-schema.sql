-- ============================================================
-- Migration 001 — Initial Schema
-- ============================================================
-- Базовите таблици на CRM-а: profiles (от auth), crm_columns,
-- crm_dropdown_options, crm_clients, crm_cell_values (EAV модел).
--
-- ИСТОРИЯ: на live базата тези таблици са били създадени ръчно преди
-- да започне историята на миграциите (която стартираше от 002). Тази
-- миграция реконструира схемата за нов проект (dev/staging среда).
--
-- Безопасно за live: всички CREATE са с IF NOT EXISTS — пускането на
-- live не променя нищо (таблиците вече съществуват).
-- ============================================================

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- profiles — разширение на auth.users с роля и име
-- ============================================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'employee'
    check (role in ('admin', 'manager', 'employee')),
  created_at timestamptz not null default now()
);

-- ============================================================
-- crm_columns — динамичните колони на таблица Клиенти (EAV definitions)
-- ============================================================
create table if not exists crm_columns (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  type text not null
    check (type in ('text', 'number', 'date', 'dropdown', 'checkbox', 'email', 'phone')),
  position int not null default 0,
  is_required bool not null default false,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_columns_position on crm_columns(position);

-- ============================================================
-- crm_dropdown_options — стойностите за dropdown колоните
-- ============================================================
create table if not exists crm_dropdown_options (
  id uuid primary key default uuid_generate_v4(),
  column_id uuid not null references crm_columns(id) on delete cascade,
  value text not null,
  color text,
  position int not null default 0
);

create index if not exists idx_dropdown_column on crm_dropdown_options(column_id);

-- ============================================================
-- crm_clients — основна таблица; реалните стойности са в cell_values
-- ============================================================
create table if not exists crm_clients (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  assigned_to uuid references profiles(id),
  deleted bool not null default false
);

create index if not exists idx_clients_deleted on crm_clients(deleted);
create index if not exists idx_clients_assigned on crm_clients(assigned_to);

-- ============================================================
-- crm_cell_values — EAV: стойностите на клетките (client_id × column_id)
-- ============================================================
create table if not exists crm_cell_values (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  column_id uuid not null references crm_columns(id) on delete cascade,
  value_text text,
  value_number numeric,
  value_date date,
  value_bool bool,
  value_dropdown uuid references crm_dropdown_options(id) on delete set null,
  unique (client_id, column_id)
);

create index if not exists idx_cell_values_client on crm_cell_values(client_id);
create index if not exists idx_cell_values_column on crm_cell_values(column_id);
