-- ============================================
-- Migration 005 — Subscriptions + Expenses cleanup
-- ============================================

-- Make date nullable on crm_expenses (fixed monthly costs don't need a date)
alter table crm_expenses alter column date drop not null;

-- Subscriptions table
create table crm_subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references crm_clients(id),
  amount numeric not null,
  currency text not null default 'EUR',
  payment_period text not null default 'monthly',
  notes text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_subscriptions_client on crm_subscriptions(client_id);
create index idx_subscriptions_active on crm_subscriptions(is_active);

alter table crm_subscriptions enable row level security;
create policy "subscriptions_read" on crm_subscriptions for select using (true);
create policy "subscriptions_insert" on crm_subscriptions for insert with check (true);
create policy "subscriptions_update" on crm_subscriptions for update using (true);
create policy "subscriptions_delete" on crm_subscriptions for delete using (true);
