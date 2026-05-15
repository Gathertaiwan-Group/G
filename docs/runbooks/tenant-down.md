# Runbook: Tenant down

> Spec §9 "Tenant runtime — crashes, healthcheck failures". Triggered by the
> 5-min health-check cron's 3-streak ALERT to #platform-ops (via
> `SLACK_WEBHOOK_URL`), or a customer report.

## Symptom

A tenant's storefront, API, or MCP endpoint is 5xx/unreachable.
`tenant_health_log` shows recent rows with `vercel_ok`/`api_ok`/`mcp_ok`/
`supabase_ok = false`. Control dashboard home "Max health-fail streak" ≥ 3
(`health.consecutiveFailures()`), or the tenant detail page health strip
shows red.

## Diagnose

1. Identify the tenant and its infra in the control dashboard:
   `/tenants?q=<slug>` → `/tenants/<id>` (Infrastructure section: Vercel
   deployment / Railway api / Railway mcp / Supabase ref). The same fields
   live in the `tenant_infrastructure` row
   (`vercel_deployment_url`, `railway_api_url`, `railway_mcp_url`,
   `supabase_url`).
2. Probe each layer exactly as the health-check cron
   (`apps/workers/src/cron/health-check.ts`) does — note the cron treats
   Vercel as ok for `status < 500` and api/mcp/supabase as ok for `res.ok`:
   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://<vercel_deployment_url>/   # ok if < 500
   curl -sS https://<railway_api_url>/health                                    # expect {"status":"ok"...}
   curl -sS https://<railway_mcp_url>/health                                    # expect 200 (mcp route is /health, NOT /healthz)
   curl -sS -H "apikey: <anon>" https://<supabase_url>/auth/v1/health           # expect 200
   ```
3. Control DB — last 20 checks for the tenant:
   ```sql
   select checked_at, vercel_ok, api_ok, mcp_ok, supabase_ok, details
   from tenant_health_log where tenant_id = '<id>'
   order by checked_at desc limit 20;
   ```
   (`details` carries the per-probe `{status}` / `{error}` written by
   `recordHealth`.)
4. Read the failing layer's native logs (Vercel deploy logs / Railway service
   logs / Supabase logs — v1 has no aggregation, open the provider console).

## Resolve

- **Single layer just deployed and broke** → this is a deploy regression for
  this tenant: follow `code-deploy-broke-everyone.md` (single-tenant rollback
  is `scripts/rollback-tenant.ts`).
- **Railway service crashed / OOM** → redeploy the api or mcp service from the
  Railway console; both are stateless and read config from env + the tenant
  Supabase.
- **Supabase project paused / over quota** → follow `supabase-quota-hit.md`.
- **Vercel build failing** → check the Vercel project deploy; if a bad
  `production` commit, revert the PR on `production` and re-run the fan-out
  (`.github/workflows/deploy-production-fanout.yml`).
- After recovery, confirm the next 5-min health-check tick is green in
  `tenant_health_log`; the dashboard streak resets to 0
  (`health.consecutiveFailures()` returns 0 once a green row lands).

## Escalate

- > 5 min customer-visible downtime → notify the customer (spec §9 layer
  table: "notifies customer if >5 min").
- Multiple tenants down simultaneously → this is platform-wide:
  `code-deploy-broke-everyone.md`, ALERT + page the platform admin.

## USER-ACTIONABLE

Notifying the customer and any provider-console action (Railway redeploy,
Supabase unpause, Vercel revert) are performed by the on-call human; no agent
performs production recovery actions.
