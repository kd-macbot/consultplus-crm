-- Миграция 067 — препратено писмо → ред във „Възможности"
--
-- ADDITIVE: само нови nullable колони + един булев с default. Нищо
-- съществуващо не се пипа и заварените редове не променят поведението си.
--
-- ЗАЩО `needs_review` е с default FALSE, а не TRUE: заварените редове са
-- въведени на ръка от админ, тоест вече са „прегледани". Обратният default
-- щеше да маркира всичките 100% като чакащи преглед в деня на миграцията и
-- броячът щеше да е безполезен точно когато трябва да се ползва.
-- Редовете от писмо изрично слагат TRUE.
--
-- Другите две колони са СЛЕДАТА: като колега види странен ред, да може да
-- каже откъде е дошъл, без да рови в логовете на едж функцията.

alter table crm_opportunities
  add column if not exists needs_review boolean not null default false;

alter table crm_opportunities
  add column if not exists intake_from text;

alter table crm_opportunities
  add column if not exists intake_subject text;

comment on column crm_opportunities.needs_review is
  'Редът е предложен автоматично (препратено писмо) и чака човек да го сверИ.';
comment on column crm_opportunities.intake_from is
  'Кой колега е препратил писмото. NULL = въведено на ръка.';
comment on column crm_opportunities.intake_subject is
  'Темата на препратеното писмо — за разпознаване.';

-- Частичен индекс: търси се САМО „кои чакат преглед", а те са шепа.
-- Пълен индекс по булев с 99% еднаква стойност не върши работа.
create index if not exists idx_opp_needs_review
  on crm_opportunities (created_at desc)
  where needs_review = true and deleted = false;

-- RLS НЕ се пипа. Таблицата е admin-only (мигр. от 08.2026) и edge
-- функцията пише със service role, който така или иначе минава покрай RLS.

notify pgrst, 'reload schema';
