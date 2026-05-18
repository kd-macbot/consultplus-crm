-- Migration 009: extra fields in crm_contacts populated from regdata
--
-- vat_registered_at: дата на регистрация по ДДС (от vat.states[].date)
-- public_url: линк към публичния запис в web.apis.bg
--
-- Run in Supabase SQL Editor.

ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS vat_registered_at date;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS public_url text;
