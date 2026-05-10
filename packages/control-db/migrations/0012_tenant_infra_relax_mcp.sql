-- Phase C-1: register the realreal tenant in the control plane before Phase
-- C-3 has built apps/mcp. tenant_infrastructure currently requires
-- railway_mcp_service_id NOT NULL, but realreal's MCP service doesn't exist
-- yet — it will be added in C-3 once apps/mcp is written and deployed.
--
-- Make the MCP fields nullable so a tenant can be registered with the
-- existing Vercel + Railway api + Supabase wiring, and the MCP fields
-- backfilled later in C-3. Future tenants always provision MCP at creation
-- time (Phase D pipeline) so they will populate these fields immediately.

alter table tenant_infrastructure
  alter column railway_mcp_service_id drop not null;

-- railway_mcp_url was already nullable (no NOT NULL in original schema).
-- Including a defensive check for forward compatibility:
alter table tenant_infrastructure
  alter column railway_mcp_url drop not null;

-- Note: control DB does not maintain a schema_migrations table (only the
-- per-tenant Supabase projects do, per Phase A-3). Each control DB migration
-- is applied once via the deploy runbook.
