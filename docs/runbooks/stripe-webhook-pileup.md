# Runbook: Stripe webhook pileup & live-provision harness (Phase D)

Covers Phase D **D3** (spin up a throwaway `pioneer-test` tenant) and **D5**
(3 consecutive successful live provisions), the L3 manual harness
(`scripts/provision-throwaway.ts`), how to read provisioning job state, how to
manually replay a stuck/failed event, and the Stripe-webhook-pileup incident
response (spec §9 / §10).

> **Test mode only.** Phase D is Stripe **test-mode**. Never point this harness
> or the test webhook at a live Stripe key.

---

## A. Stripe webhook pileup (incident response)

**Symptom:** `provisioning_jobs` backlog grows; many rows `queued`; the Stripe
dashboard shows webhook delivery retries.

### Diagnose

1. Is the workers process up?

   ```bash
   curl -sS https://<workers-host>/health
   # => {"status":"ok","service":"workers","uptime_seconds":...}
   ```

2. Control DB — job state distribution:

   ```sql
   select status, count(*) from provisioning_jobs group by status;
   select step, status, count(*) from provisioning_jobs
     group by step, status order by step;
   ```

3. Check Railway logs for the `apps/workers` service for `dispatch` errors or
   Mgmt-API quota (`429`). Components log under pino names `workers`,
   `stripe-webhook`, `dispatch`, `stuck-sweep`.

### Resolve

- **Workers down** → redeploy the workers Railway service. On boot it drains
  the queue (poll runner + dispatcher).
- **Mgmt-API quota (429)** → wait for the provider quota window to reset. Jobs
  auto-retry on the `attempt`-driven backoff (`available_at`); no manual action
  needed.
- **Poison job** (`attempt=3`, `failed`) → fix the root cause, then replay the
  step (see §C "Manual replay").
- **Duplicate Stripe deliveries** are deduped by `stripe_webhook_events`
  (persistent idempotency). Safe — no action.

### Escalate

If the backlog is > 50 jobs, or any job is stuck > 30 min, the 30-minute
stuck-job sweep (`scheduleStuckJobSweep`, pino name `stuck-sweep`) requeues the
stuck rows and ALERTs `#platform-ops` (via `SLACK_WEBHOOK_URL`). Page the
on-call platform admin.

---

## B. D3 / D5 — running a live (test-mode) provision

The harness mirrors exactly what the merged Stripe
`checkout.session.completed` webhook does
(`apps/workers/src/webhooks/stripe.ts`): it inserts a `tenants` row and
enqueues the 8 provisioning steps. The already-running `apps/workers` process
then drives the real, merged step handlers + dispatcher. The script only seeds
and polls — it does **not** modify any pipeline logic and never calls Stripe or
a Mgmt API directly.

### B.1 USER-ACTIONABLE prerequisites (a human must do these — NOT automated)

These cannot be done by an agent; they need real dashboards / secrets:

1. **Stripe test-mode setup (spec §12 open question 2).** In the Stripe
   dashboard (TEST mode): create the product + price, configure a test webhook
   endpoint pointing at `https://<workers-host>/webhooks/stripe`, then copy
   `STRIPE_SECRET_KEY` (test) and `STRIPE_WEBHOOK_SECRET` into the workers
   Railway service env.
2. **Provide Mgmt-API tokens** as workers Railway env vars:
   `SUPABASE_PAT`, `SUPABASE_ORG_ID`, `VERCEL_TOKEN`, `RAILWAY_TOKEN`,
   `RESEND_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_PLATFORM_ZONE_ID`,
   `PLATFORM_KEK`, `OWNER_ADMIN_EMAIL`, `SLACK_WEBHOOK_URL`,
   plus the control-DB connection (`CONTROL_DB_URL`,
   `CONTROL_DB_SERVICE_ROLE_KEY`).
3. **Provide `PIONEER_OWNER_ID`** in the environment where the script runs —
   the existing auth user id that will own the throwaway tenant.
4. **BYO-domain tenants:** the customer must set their DNS, and a human
   operates the v1 manual confirm gate (control admin `/tenants/[id]` →
   "Mark domain configured"). Not exercised by `pioneer-test-*` (it uses
   `custom_domain: null`).

### B.2 AUTOMATED — what the harness does for you

Once B.1 is satisfied and the workers process is running, a human runs the
script and everything below is automated by the merged pipeline:

```bash
cd /path/to/repo                       # repo root (NOT apps/workers)
ALLOW_LIVE_PROVISION=yes \
  PIONEER_OWNER_ID=<auth-user-uuid> \
  CONTROL_DB_URL=<...> CONTROL_DB_SERVICE_ROLE_KEY=<...> \
  npx tsx scripts/provision-throwaway.ts 3      # D5: 3 consecutive runs (omit arg = 1)
```

The script:

- Hard-refuses unless `ALLOW_LIVE_PROVISION=yes` (so it can never run in CI;
  the unit test only imports `assertLiveAllowed`).
- For each run: creates `pioneer-test-<base36>-<n>` via `tenants.createTenant`
  and enqueues the 8 steps via `jobs.enqueueJobs` (same steps the webhook uses:
  `validate`, `supabase_setup`, `resend_setup`, `cloudflare_dns`,
  `vercel_setup`, `railway_setup`, `domain_finalize`, `tenant_finalize`).
- Polls `tenants.getTenant` every 10 s until `active` (pass) or `failed`
  (exit 1), 12-minute timeout per run.
- Prints `✓ N consecutive successful live provisions` on success.

### B.3 USER-ACTIONABLE smoke (after green runs)

For each provisioned tenant, a human confirms:

- storefront site → `200`
- workers `/health` → `200`
- tenant API `/healthz` → `200`

---

## C. Reading job state & manual replay

### Read job state (control DB)

```sql
-- all jobs for a tenant, in order
select step, status, attempt, last_error, available_at, finished_at
from provisioning_jobs
where tenant_id = '<tenant-uuid>'
order by created_at;

-- tenant lifecycle
select id, slug, status, activated_at from tenants where slug like 'pioneer-test-%';
```

Terminal tenant states: `active` (success) / `failed` (a step exhausted
retries). Per-job retry/backoff is `attempt`-driven (30 s → 2 min → fail +
alert), tracked on `provisioning_jobs.available_at`.

### Manual replay of a stuck / failed step (spec §ambiguity-2)

**Preferred:** the control admin UI `/jobs` → "Retry from this step", which
re-queues the job with `attempt=0`. (The `/jobs` admin surface lives in the
control app, out of scope for this PR; use it if available in your env.)

**Verified fallback (control DB):** re-queue the failed step directly. This is
exactly the shape the merged `jobs.requeueJob` / stuck-sweep use
(`status='queued'`, reset `attempt`, set `available_at`, clear `started_at`):

```sql
update provisioning_jobs
set status      = 'queued',
    attempt     = 0,
    last_error  = null,
    available_at = now(),
    started_at  = null
where tenant_id = '<tenant-uuid>' and step = '<failed-step>';
```

The running workers process will re-claim it on the next poll. Handlers are
idempotent (`isComplete()` short-circuits already-done infra), so replay is
safe. If the tenant row is `failed`, also reset it so the pipeline can finish:

```sql
update tenants set status = 'provisioning' where id = '<tenant-uuid>';
```

---

## D. Teardown (USER-ACTIONABLE)

Throwaway `pioneer-test-*` tenants create real test-infra resources. After D3 /
D5, a human must tear each down (no automated teardown ships in this PR):

- Supabase: delete the `tenant-<slug>` project.
- Vercel: delete the tenant project.
- Railway: delete the tenant API + MCP services.
- Resend: remove the tenant domain.
- Cloudflare: delete the tenant CNAME in `CLOUDFLARE_PLATFORM_ZONE_ID`.
- Control DB: delete the `tenants` + `provisioning_jobs` +
  `tenant_infrastructure` rows for the tenant.

---

## E. Known issues / follow-ups

- **Tenant DB password is KEK-derived (PR-D6 follow-up).**
  `apps/workers/src/provisioning/steps/supabase-setup.ts` currently sets the
  per-tenant Supabase DB password to `requireEnv("PLATFORM_KEK").slice(0, 24)`
  — i.e. every tenant DB shares one password derived from the platform KEK.
  This is a known hardening item tracked separately (generate a per-tenant
  random password, KEK-encrypt it into `tenant_infrastructure`). It does not
  block D3/D5 but **must** be resolved before any non-test tenant. Do not
  "fix" it from this harness PR — it touches merged production step logic.
- The `/jobs` "Retry from this step" admin UI lives in the control app
  (out of scope here); the verified path for this PR is the control-DB
  re-queue SQL in §C.
