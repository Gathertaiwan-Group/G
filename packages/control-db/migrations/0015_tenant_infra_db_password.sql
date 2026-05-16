-- Phase D hardening (PR-D6 review): persist the per-tenant Supabase Postgres
-- password. Before this change the DB password was a slice of the single
-- PLATFORM_KEK (apps/workers .../steps/supabase-setup.ts) and was never
-- stored; it is now a per-tenant CSPRNG secret, KEK-encrypted with the same
-- aes-256-gcm scheme as supabase_service_role_key_encrypted.
--
-- Nullable (no NOT NULL): tenants provisioned before this migration have no
-- stored DB password and must keep working. New tenants always populate it
-- at supabase_setup time. Control DB has no schema_migrations table — each
-- migration is applied once via the deploy runbook (see 0012).

alter table tenant_infrastructure
  add column if not exists supabase_db_password_encrypted bytea;

comment on column tenant_infrastructure.supabase_db_password_encrypted is
  'aes-256-gcm encrypted with PLATFORM_KEK. Format: 12-byte IV || ciphertext || 16-byte auth tag.';
