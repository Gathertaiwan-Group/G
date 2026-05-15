# Runbook: Code deploy broke everyone

> Spec §7 rollback table + the `deploy-production-fanout` `monitor` job
> (`.github/workflows/deploy-production-fanout.yml` → `scripts/deploy-monitor-run.ts`:
> 70-min job / 1h watch, 5-min poll, 3-consecutive-failure streak → auto
> Vercel rollback + Railway redeploy via `scripts/rollback-tenant.ts`, ALERT
> via `SLACK_WEBHOOK_URL`). Spec §9 "Platform-wide breakage".

## Symptom

After a push to `production` and the fan-out deploy, multiple tenants 5xx. The
`monitor` job alerts #platform-ops ("Auto-rollback executed/FAILED for
<slug>"), or the dashboard home shows many tenants with health-fail streaks
(`health.consecutiveFailures()` ≥ 3 across tenants).

## Diagnose

1. Confirm it correlates with a `production` deploy:
   ```bash
   git log production --oneline -5
   ```
2. Control DB — breadth of impact over the last 30 minutes:
   ```sql
   select tenant_id,
          count(*) filter (
            where not (vercel_ok and api_ok and mcp_ok and supabase_ok)
          ) as fails
   from tenant_health_log
   where checked_at > now() - interval '30 minutes'
   group by tenant_id order by fails desc;
   ```
3. Check the GitHub Actions `deploy-production-fanout` run: did `canary` pass
   but `promote` break tenants? Did the `monitor` job already auto-roll-back
   some (read its step log / the #platform-ops Slack messages)?

## Resolve

- **The `monitor` job already auto-rolled-back affected tenants** (those that
  hit a 3-streak): verify each rolled-back tenant returns to green in
  `tenant_health_log`. For tenants that failed but had a < 3-streak (not
  auto-rolled), roll back manually per tenant. The CLI is positional —
  `<vercelProjectId> <railwayApiServiceId>` — with tokens in env (see the
  `require.main` block of `scripts/rollback-tenant.ts`; ids come from the
  control DB `tenant_infrastructure` row's `vercel_project_id` /
  `railway_api_service_id`):
  ```bash
  VERCEL_TOKEN=… RAILWAY_TOKEN=… \
    npx tsx scripts/rollback-tenant.ts <vercelProjectId> <railwayApiServiceId>
  ```
  This promotes the previous READY Vercel production deployment
  (`rollbackVercel`) then redeploys the previous good Railway api build
  (`deployRailwayService`) — the same `rollbackTenant()` the monitor calls.
- **Root cause is a bad `production` commit** → revert the PR on `production`
  and re-run `deploy-production-fanout` (`canary` gates it; the manual
  approval on `promote` is your checkpoint). Never write a destructive `down`
  migration — ship a forward-fix migration (spec §7).
- **DB migration regression** → forward-fix migration only; re-run the
  `migrations` fan-out job (`scripts/fanout-migrations.ts`).

## Escalate

`monitor` reported "Auto-rollback FAILED for <slug>" → that tenant needs
hands-on recovery (provider console); page the platform admin. Platform-wide
and not recovering after revert → declare incident, ALERT + page.

## USER-ACTIONABLE

Reverting the `production` PR, approving the re-run's `promote` gate, and any
provider-console rollback are human-operator actions. The agent ships the
automation and this runbook; it does not revert production or approve gates.
