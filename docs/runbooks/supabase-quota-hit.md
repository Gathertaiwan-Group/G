# Runbook: Supabase quota / project limit hit

> Spec §9 "Mgmt API quota" + §12 Q3 "Resend/Supabase account quota". Each
> tenant gets its own Supabase project (the realreal tenant is
> `ozwftlkgqmewtadypsfi`; the control plane itself is
> `yqedxfaxbgnlkcrzgmik`). The platform org has a finite project + compute
> budget, and provisioning's `supabase_setup` step calls the Supabase
> Management API with `SUPABASE_PAT` / `SUPABASE_ORG_ID`.

## Symptom

Provisioning step `supabase_setup` fails with a 4xx mentioning quota/limit, or
an existing tenant's `supabase_ok=false` in `tenant_health_log` with the
Supabase project paused, or the Supabase org dashboard shows the project cap
reached.

## Diagnose

1. Control DB — which tenants and which step failed:
   ```sql
   select tenant_id, step, status, attempt, last_error
   from provisioning_jobs
   where status = 'failed' and step = 'supabase_setup'
   order by created_at desc;
   ```
2. Supabase org dashboard → project count vs plan cap; per-project compute /
   storage / egress usage. The control project `yqedxfaxbgnlkcrzgmik` and the
   realreal tenant `ozwftlkgqmewtadypsfi` are always present; new
   `tenant-<slug>` projects are the ones that hit the cap.
3. Distinguish: (a) **org project-count cap** (cannot create new tenants),
   (b) **per-project resource** (one tenant degraded), (c) **Mgmt-API rate
   limit 429** (transient — provisioning auto-retries on the `attempt`-driven
   backoff: 30s → 2min).

## Resolve

- **429 Mgmt-API rate limit** → no action; the provisioning retry ladder
  drains it (`provisioning_jobs.available_at` gates re-claim). Confirm jobs
  move `failed` → `queued` → `success`. To force an immediate re-claim of a
  specific step, use the `/jobs` "Retry from this step" admin action (PR-E2,
  backed by `jobs.requeueStep(client, tenantId, step)`).
- **Per-project resource exhaustion** → upgrade that tenant's Supabase project
  compute add-on in the Supabase dashboard; tenants are single-Supabase so the
  blast radius is one tenant.
- **Org project-count cap** → provisioning of *new* tenants is blocked. Upgrade
  the Supabase org plan / open a quota request. Until then, new
  `provisioning_jobs` rows for `supabase_setup` will keep failing; pause intake
  by NOT flipping Stripe to live capacity (see `../ga-go-live-checklist.md`).

## Escalate

Org cap reached with paid customers waiting → ALERT #platform-ops + email; this
gates GA throughput and is a §12 Q3 open item to resolve before scaling.

## USER-ACTIONABLE

Supabase plan upgrades, quota-increase requests, and per-project compute
changes require billing access to the Supabase org dashboard — performed by
the human operator, not an agent.
