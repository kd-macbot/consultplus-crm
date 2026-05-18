-- ============================================
-- Migration 008 — RegData token cache
-- Кеш на accessToken/refreshToken от regdata.apis.bg
-- ============================================

create table crm_regdata_token (
  id            int primary key default 1,
  access_token  text not null,
  refresh_token text,
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default now(),
  constraint single_row check (id = 1)
);

alter table crm_regdata_token enable row level security;

-- Никой клиент няма пряк достъп — само service_role (edge functions, скриптове)
-- → не добавяме policy за read/write от обикновени потребители.
