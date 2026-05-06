-- ============================================
-- Migration 006 — Profiles: admin management
-- ============================================

-- Add is_active flag so admins can deactivate users without deleting them
alter table profiles add column if not exists is_active bool not null default true;

-- Security-definer helper: avoids RLS recursion when checking admin role
create or replace function is_current_user_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Drop any existing policies we are replacing (safe even if they don't exist)
drop policy if exists "profiles_select_own"   on profiles;
drop policy if exists "profiles_update_own"   on profiles;
drop policy if exists "profiles_select"        on profiles;
drop policy if exists "profiles_update"        on profiles;
drop policy if exists "profiles_insert"        on profiles;

-- Users see their own row; admins see all rows
create policy "profiles_select" on profiles
  for select using (
    auth.uid() = id or is_current_user_admin()
  );

-- Users update their own row; admins update any row
create policy "profiles_update" on profiles
  for update using (
    auth.uid() = id or is_current_user_admin()
  );

-- Only admins can insert new profile rows (created after auth.signUp)
create policy "profiles_insert" on profiles
  for insert with check (
    is_current_user_admin()
  );
