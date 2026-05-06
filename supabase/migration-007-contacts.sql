-- ============================================
-- Migration 007 — Contacts (1:1 with clients)
-- ============================================

create table crm_contacts (
  id          uuid primary key default uuid_generate_v4(),
  client_id   uuid not null unique references crm_clients(id) on delete cascade,
  owner_name  text,
  owner_email text,
  owner_phone text,
  manager_name  text,
  manager_email text,
  company_email text,
  eik         text,
  vat_number  text,
  address     text,
  website     text,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);

create index idx_contacts_client on crm_contacts(client_id);

alter table crm_contacts enable row level security;

-- All authenticated users can read contacts
create policy "contacts_read" on crm_contacts
  for select using (auth.uid() is not null);

-- Only admin and manager can insert / update / delete
create policy "contacts_write" on crm_contacts
  for all using (
    exists (
      select 1 from profiles
      where id = auth.uid() and role in ('admin', 'manager')
    )
  );
