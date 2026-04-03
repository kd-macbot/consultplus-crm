-- Audit Log table
create table crm_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  user_name text not null,
  action text not null, -- 'create_client', 'update_cell', 'delete_client', 'create_column', 'delete_column', etc.
  entity_type text not null, -- 'client', 'column', 'dropdown', 'cell'
  entity_id uuid,
  client_name text, -- denormalized for quick display
  column_name text, -- denormalized
  old_value text,
  new_value text,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);

create index idx_audit_created on crm_audit_log(created_at desc);
create index idx_audit_user on crm_audit_log(user_id);
create index idx_audit_entity on crm_audit_log(entity_type, entity_id);

alter table crm_audit_log enable row level security;
create policy "audit_read" on crm_audit_log for select using (true);
create policy "audit_insert" on crm_audit_log for insert with check (true);

-- Tags tables
create table crm_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#6B7280',
  created_at timestamptz not null default now()
);

create table crm_client_tags (
  client_id uuid references crm_clients(id) on delete cascade,
  tag_id uuid references crm_tags(id) on delete cascade,
  primary key (client_id, tag_id)
);

alter table crm_tags enable row level security;
alter table crm_client_tags enable row level security;
create policy "tags_read" on crm_tags for select using (true);
create policy "tags_write" on crm_tags for all using (true);
create policy "client_tags_read" on crm_client_tags for select using (true);
create policy "client_tags_write" on crm_client_tags for all using (true);
