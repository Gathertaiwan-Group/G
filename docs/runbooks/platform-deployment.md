# Platform Deployment Runbook — Phase A

Deployed: 2026-05-10  
Branch: plan/phase-a-7-deploy  
Task: PR-A7

---

## Service URLs

| Service | URL |
|---------|-----|
| Control plane (Vercel) | https://control-nu-seven.vercel.app |
| Workers (Railway) | https://platform-workers-production-4770.up.railway.app |
| Custom domain (pending DNS) | https://platform.realreal.cc |
| Vercel project dashboard | https://vercel.com/armands-projects-f3e1a37d/control |
| Railway project dashboard | https://railway.com/project/dd3f7d9f-1052-4cb5-8c6a-6fa25281134a |

## Control DB

- Supabase ref: `yqedxfaxbgnlkcrzgmik`
- Supabase URL: `https://yqedxfaxbgnlkcrzgmik.supabase.co`
- Dashboard: https://supabase.com/dashboard/project/yqedxfaxbgnlkcrzgmik

---

## Environment Variables

### Railway — `platform-workers` service

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | Set to `production` |
| `NIXPACKS_NODE_VERSION` | Set to `22` |
| `CONTROL_DB_URL` | Supabase project URL |
| `CONTROL_DB_SERVICE_ROLE_KEY` | Supabase service role JWT |
| `PLATFORM_KEK` | Platform key-encryption key (32-byte hex). **LOSS = encrypted column data unrecoverable.** |
| `INTERNAL_API_SECRET` | HMAC secret for `/internal/audit` endpoint. 32-byte hex. |

> All values are stored in `/tmp/platform-secrets.txt` on the deploy machine (chmod 600).  
> Rotate by generating new hex values via `openssl rand -hex 32` and updating Railway variables.

### Vercel — `control` project

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_CONTROL_DB_URL` | Supabase URL (public, baked into JS bundle) |
| `NEXT_PUBLIC_CONTROL_DB_ANON_KEY` | Supabase anon JWT (public, baked into JS bundle) |
| `PLATFORM_WORKERS_URL` | Base URL for workers service |

---

## Build / Deploy Configuration

### Vercel (control app)

Deployed from **repo root** (monorepo). Key Vercel project settings:
- Build command: `turbo build --filter=control`
- Output directory: `apps/control/.next`
- Root directory: (repo root)

### Railway (workers app)

Deployed from **repo root** via `railway.toml` at `/railway.toml`:
- Build command: `npm install --workspaces && npm run build -w @realreal/control-db && npm run build -w workers`
- Start command: `node apps/workers/dist/index.js`
- Healthcheck path: `/health`

---

## Smoke Tests

### Workers health (Step 7.3)
```bash
curl https://platform-workers-production-4770.up.railway.app/health
# expect: {"status":"ok","service":"workers",...}
```
**Result (2026-05-10):** PASSED — `{"status":"ok","service":"workers","uptime_seconds":44}`

### Vercel control login page (Step 7.7)
```bash
curl -o /dev/null -w "%{http_code}" https://control-nu-seven.vercel.app/auth/login
# expect: 200
```
**Result:** HTTP 200 — PASSED

### HMAC audit smoke test (Step 7.7)
```bash
INTERNAL_API_SECRET="<value from /tmp/platform-secrets.txt>"
BODY='{"tenant_id":null,"actor_type":"system","action":"phase-a-deploy.smoke","payload":{"test":true}}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$INTERNAL_API_SECRET" | awk '{print $2}')
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIG" \
  -d "$BODY" \
  https://platform-workers-production-4770.up.railway.app/internal/audit
# expect: {"ok":true}
```
**Result:** PASSED — `{"ok":true}`. Audit row verified in Supabase: `id=75b6dbb9-c470-4a1e-93bf-a8f1e918bffc`, `created_at=2026-05-10T08:41:55Z`.

> Note: the actual HMAC header is `x-internal-signature` (not `X-Signature` as in the spec). Also include `actor_id: null` and `resource: null` in the body. Full working curl:
> ```bash
> BODY='{"tenant_id":null,"actor_type":"system","actor_id":null,"action":"phase-a-deploy.smoke","resource":null,"payload":{"test":true}}'
> SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$INTERNAL_API_SECRET" | awk '{print $2}')
> curl -s -X POST -H "Content-Type: application/json" -H "x-internal-signature: $SIG" -d "$BODY" $PLATFORM_WORKERS_URL/internal/audit
> ```

### Magic-link login (Step 7.8)
**Result:** USER ACTION REQUIRED — requires clicking email link in armand7951@gmail.com inbox.

---

## Manual Steps Required (post-PR)

### 1. Cloudflare DNS for platform.realreal.cc

In Cloudflare dashboard for zone `realreal.cc`:
- Record type: CNAME
- Name: `platform`
- Target: `cname.vercel-dns.com`
- Proxy: DNS only (grey cloud, not orange)
- TTL: Auto

### 2. Add custom domain to Vercel

After DNS propagates (check with `dig platform.realreal.cc`):
```bash
cd apps/control
vercel domains add platform.realreal.cc
```

### 3. Magic-link login test

1. Visit https://control-nu-seven.vercel.app/auth/login (or https://platform.realreal.cc/auth/login after DNS)
2. Enter a valid admin email
3. Click the link in the email
4. Verify you land on the dashboard

### 4. HMAC audit + DB verification

Once workers is healthy:
```bash
INTERNAL_API_SECRET="<from /tmp/platform-secrets.txt>"
BODY='{"tenant_id":null,"actor_type":"system","actor_id":null,"action":"phase-a-deploy.smoke","resource":null,"payload":{"test":true}}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$INTERNAL_API_SECRET" | awk '{print $2}')
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "x-internal-signature: $SIG" \
  -d "$BODY" \
  https://platform-workers-production-4770.up.railway.app/internal/audit

# Verify in Supabase:
# Dashboard > SQL Editor > run:
# SELECT * FROM audit_log WHERE action = 'phase-a-deploy.smoke' ORDER BY created_at DESC LIMIT 1;
```

---

## Recovery Notes

### PLATFORM_KEK loss
**Severity: CRITICAL.** The PLATFORM_KEK is used to encrypt columns in the control DB (tenant secrets, API keys, etc.). If this value is lost:
- All encrypted column data becomes unrecoverable
- No decryption is possible without the original key
- **Mitigation:** Store PLATFORM_KEK in a secrets manager (1Password, AWS Secrets Manager, etc.) immediately. Never rely solely on Railway env var storage.

### Workers service down
1. Check Railway logs: `railway logs --lines 50`
2. Check env vars are set: `railway variable list`
3. Redeploy: `cd /G && railway up --ci --detach`

### Vercel deployment rollback
```bash
vercel rollback <previous-deployment-url>
```

### Control DB connection issues
- Verify `CONTROL_DB_URL` and `CONTROL_DB_SERVICE_ROLE_KEY` are correct
- Check Supabase project status at https://supabase.com/dashboard/project/yqedxfaxbgnlkcrzgmik
- Supabase pauses projects after 1 week of inactivity on free tier

---

## Secrets Location

- `/tmp/platform-secrets.txt` (chmod 600) — contains PLATFORM_KEK, INTERNAL_API_SECRET, and Supabase keys
- This file is ephemeral (lives only on the deploy machine's /tmp). Move values to a secrets manager.
