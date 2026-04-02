-- ============================================
-- Migration 002 — Staff / Personnel Table
-- ============================================

create table crm_staff (
  id uuid primary key default uuid_generate_v4(),
  full_name text not null,
  position text,
  department text,
  email text,
  phone text,
  is_active bool not null default true,
  created_at timestamptz not null default now()
);

create index idx_staff_active on crm_staff(is_active);
create index idx_staff_department on crm_staff(department);

alter table crm_staff enable row level security;

create policy "staff_read" on crm_staff for select using (true);
create policy "staff_write" on crm_staff for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
