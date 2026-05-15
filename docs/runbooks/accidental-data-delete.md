# Runbook: Accidental tenant data deletion

> Spec §9 "Backups": each tenant Supabase project runs Supabase Pro PITR
> (7 days), one-click restore. Tenant Storage has NO v1 backup (accepted
> risk). The realreal tenant project is `ozwftlkgqmewtadypsfi`; new tenants
> get their own `tenant-<slug>` project.

## Symptom

A tenant reports missing products/orders/users, or an MCP `delete_*` /
`update_*` tool call (or admin action) destroyed data. The control plane
`audit_log` and/or the tenant DB `config_history` show the destructive action.

## Diagnose

1. Scope the damage and time window from the control plane `audit_log`
   (`actor_type='customer_agent'` rows are MCP tool calls — see
   `packages/control-db/src/types.ts` `ActorType`):
   ```sql
   -- control plane: who/when destroyed what
   select created_at, actor_type, actor_id, action, resource, payload
   from audit_log where tenant_id = '<id>'
     and action ilike '%delete%'
   order by created_at desc limit 50;
   ```
2. In the tenant's Supabase, inspect `config_history`
   (`packages/db/migrations/0019_config_history.sql` — trigger-written on
   `site_contents.value` changes) for content changes, and check the affected
   tables' row counts vs the customer's expectation.
3. Pick a **restore target timestamp** strictly before the destructive action.

## Resolve

- **Data in Postgres (products/orders/users/site_contents/config_history)** →
  Supabase dashboard for the tenant's project → Database →
  **Point-in-Time Recovery** → restore to the target timestamp (≤ 7 days).
  This restores the whole tenant DB; coordinate a brief tenant freeze first
  via the control dashboard `/tenants/<id>/suspend` (PR-E2 suspend action) so
  no writes are lost mid-restore, then resume.
- **Partial / surgical** (one table) → if a full PITR would lose good newer
  data, do a PITR restore into a *clone* project, export the needed rows, and
  import them back into the live tenant DB. (Slower; only when a full restore
  would discard good newer data.)
- **Storage objects (images/branding/posts-media)** → NO v1 backup (spec §9).
  Ask the customer for source files and re-upload. Record as a known v1 risk.

## Escalate

Any restore that would lose newer good data, or a destructive MCP tool call
with no `audit_log` row → ALERT #platform-ops; review whether the MCP tool
needs a confirmation gate (feed into the tool-catalog backlog).

## USER-ACTIONABLE

PITR restore is performed by the human operator in the Supabase dashboard
(irreversible window selection, customer coordination). No agent triggers a
production data restore.
