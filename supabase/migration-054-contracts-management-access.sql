-- ============================================================
-- Migration 054 — Достъп до Шаблони (договори) за Управление
-- ============================================================
-- Досега договорите бяха само admin (миграция 053). Отваряме ги и за
-- мениджърите от отдел „Управление".
--
-- ЗАСЕЧКАТА: няма връзка profiles ↔ crm_staff в базата. Ролята живее в
-- profiles, а отделът — в crm_staff, и двете се съпоставят ПО ИМЕ (виж
-- useMyStaff.ts / namesMatch в utils.ts: trim + collapse spaces + lowercase).
-- Затова helper-ът повтаря същото нормализиране в SQL. Ако някой ден се появи
-- истински ключ между двете таблици, тази функция е единственото място за
-- смяна откъм база.
--
-- Отделът се брои и когато е основен (department), и когато е допълнителен
-- (additional_departments) — точно както inDept() в UI.
--
-- Идемпотентно.
-- ============================================================

create or replace function is_current_user_management()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from profiles p
    join crm_staff s
      on lower(regexp_replace(btrim(s.full_name), '\s+', ' ', 'g'))
       = lower(regexp_replace(btrim(p.full_name), '\s+', ' ', 'g'))
    where p.id = (select auth.uid())
      and p.role = 'manager'
      and s.is_active
      and btrim(coalesce(p.full_name, '')) <> ''
      and (
        s.department = 'Управление'
        or 'Управление' = any(coalesce(s.additional_departments, '{}'::text[]))
      )
  );
$$;

-- Функцията се вика от RLS политики при SELECT → правата ѝ не се отнемат.
-- (Виж урока от миграция 050: REVOKE от helper счупи четенето на Клиенти.)
revoke all on function is_current_user_management() from public;
grant execute on function is_current_user_management() to authenticated;

-- ---- Политиките ------------------------------------------------------
drop policy if exists "contract_templates_all" on crm_contract_templates;
create policy "contract_templates_all" on crm_contract_templates
  for all to authenticated
  using (is_current_user_admin() or is_current_user_management())
  with check (is_current_user_admin() or is_current_user_management());

drop policy if exists "contracts_all" on crm_contracts;
create policy "contracts_all" on crm_contracts
  for all to authenticated
  using (is_current_user_admin() or is_current_user_management())
  with check (is_current_user_admin() or is_current_user_management());

NOTIFY pgrst, 'reload schema';
