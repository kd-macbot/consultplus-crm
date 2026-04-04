-- ============================================
-- Migration 004 — Expenses Table
-- ============================================

create table crm_expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  description text,
  amount numeric not null,
  currency text not null default 'EUR',
  date date not null,
  staff_id uuid references crm_staff(id),
  recurring boolean not null default false,
  recurring_period text, -- 'monthly', 'quarterly', 'yearly'
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_expenses_date on crm_expenses(date desc);
create index idx_expenses_category on crm_expenses(category);
create index idx_expenses_staff on crm_expenses(staff_id);
create index idx_expenses_created_by on crm_expenses(created_by);

alter table crm_expenses enable row level security;
create policy "expenses_read" on crm_expenses for select using (true);
create policy "expenses_insert" on crm_expenses for insert with check (true);
create policy "expenses_update" on crm_expenses for update using (true);
create policy "expenses_delete" on crm_expenses for delete using (true);
