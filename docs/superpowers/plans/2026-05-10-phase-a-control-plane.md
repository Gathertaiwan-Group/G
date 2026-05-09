# Phase A — Control Plane Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the platform-level "control plane" — a separate Supabase project, Next.js dashboard at `platform.realreal.cc`, and a Railway worker service — that will manage all future tenants. At the end of Phase A the control plane has zero tenants but is fully functional and ready for Phase B.

**Architecture:** Three new pieces deployed to platform-owned infrastructure (separate from realreal): (1) `platform-control` Supabase for tenant registry, (2) `apps/control` Next.js dashboard at `platform.realreal.cc`, (3) `apps/workers` Node/Express service on Railway running cron jobs and (eventually) provisioning workers. New `packages/control-db` library provides typed helpers and AES-256-GCM encryption of tenant credentials. Six tenant-DB migrations (0015–0020) are added to `packages/db/migrations/` and applied to realreal's existing Supabase to prove backward compatibility.

**Tech Stack:** Next.js 16, Express 5, TypeScript, Supabase (Postgres 17), Vitest, Vercel, Railway, Cloudflare DNS, Supabase Management API. Node 22+ (already required by realreal Railway).

**Spec reference:** `docs/superpowers/specs/2026-05-10-multi-tenant-platform-foundation-design.md` §3, §4, §5 (schema additions), §11 Phase A.

**Out of scope for this plan:** Provisioning step handlers (Phase D), tenant registration (Phase C), MCP server (Phase C), F refactor (Phase B). Workers in Phase A only run cron + the audit-emit endpoint; the Stripe webhook receiver is a skeleton that records `event_id` for idempotency but does not yet enqueue jobs.

---

## File Structure

```
G/
├── apps/
│   ├── control/                                    [NEW: PR-A5, PR-A6]
│   │   ├── package.json
│   │   ├── next.config.ts
│   │   ├── tsconfig.json
│   │   ├── postcss.config.mjs
│   │   ├── eslint.config.mjs
│   │   ├── components.json
│   │   ├── public/                                 (empty initially)
│   │   └── src/
│   │       ├── app/
│   │       │   ├── layout.tsx
│   │       │   ├── globals.css
│   │       │   ├── page.tsx                        (overview dashboard)
│   │       │   ├── auth/
│   │       │   │   ├── login/page.tsx
│   │       │   │   └── callback/route.ts
│   │       │   ├── tenants/
│   │       │   │   ├── page.tsx
│   │       │   │   └── [id]/page.tsx
│   │       │   ├── jobs/page.tsx
│   │       │   ├── audit/page.tsx
│   │       │   └── billing/page.tsx
│   │       ├── lib/
│   │       │   ├── auth.ts
│   │       │   ├── control-db.ts
│   │       │   └── format.ts
│   │       └── components/
│   │           └── ui/                              (shadcn/ui primitives)
│   └── workers/                                    [NEW: PR-A4]
│       ├── package.json
│       ├── tsconfig.json
│       ├── railway.toml
│       └── src/
│           ├── index.ts                            (HTTP entry + cron scheduler)
│           ├── webhooks/
│           │   └── stripe.ts                       (skeleton, full impl in Phase D)
│           ├── jobs/
│           │   └── runner.ts                       (skeleton job runner)
│           ├── cron/
│           │   ├── health-check.ts
│           │   ├── resend-dkim-verify.ts           (skeleton, full in Phase D)
│           │   └── stripe-sync.ts                  (skeleton)
│           ├── routes/
│           │   └── audit.ts                        (POST /internal/audit, HMAC-signed)
│           └── lib/
│               └── hmac.ts
├── packages/
│   ├── control-db/                                 [NEW: PR-A2]
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── client.ts                           (Supabase client factory)
│   │   │   ├── crypto.ts                           (aes-256-gcm)
│   │   │   ├── types.ts                            (TenantStatus, ModuleKey, etc.)
│   │   │   └── queries/
│   │   │       ├── tenants.ts
│   │   │       ├── jobs.ts
│   │   │       ├── audit.ts
│   │   │       └── health.ts
│   │   ├── migrations/                             [NEW: PR-A1]
│   │   │   ├── 0001_platform_users.sql
│   │   │   ├── 0002_tenants.sql
│   │   │   ├── 0003_tenant_infrastructure.sql
│   │   │   ├── 0004_tenant_modules.sql
│   │   │   ├── 0005_provisioning_jobs.sql
│   │   │   ├── 0006_audit_log.sql
│   │   │   ├── 0007_tenant_health_log.sql
│   │   │   ├── 0008_billing_subscriptions.sql
│   │   │   └── 0009_stripe_webhook_events.sql
│   │   └── __tests__/
│   │       ├── crypto.test.ts
│   │       └── queries.test.ts
│   └── db/migrations/                              [APPEND: PR-A3]
│       ├── 0015_schema_migrations.sql
│       ├── 0016_courses_schema.sql
│       ├── 0017_crowdfund_schema.sql
│       ├── 0018_booking_schema.sql
│       ├── 0019_config_history.sql
│       └── 0020_brand_seed.sql
├── infrastructure/
│   └── provisioning/                               [NEW: PR-A1]
│       └── apply-control-migrations.ts             (one-shot script to apply control DB schema)
├── turbo.json                                      [MODIFY: PR-A4 — add tasks for new apps]
└── package.json                                    [MODIFY: PR-A4 — add workspace globs]
```

---

## Task 1 (PR-A1): Provision platform-control Supabase + apply control DB schema

**Goal:** A new Tokyo Supabase project named `platform-control` exists, all 9 control DB tables created, schema verified.

**Files:**
- Create: `packages/control-db/migrations/0001_platform_users.sql`
- Create: `packages/control-db/migrations/0002_tenants.sql`
- Create: `packages/control-db/migrations/0003_tenant_infrastructure.sql`
- Create: `packages/control-db/migrations/0004_tenant_modules.sql`
- Create: `packages/control-db/migrations/0005_provisioning_jobs.sql`
- Create: `packages/control-db/migrations/0006_audit_log.sql`
- Create: `packages/control-db/migrations/0007_tenant_health_log.sql`
- Create: `packages/control-db/migrations/0008_billing_subscriptions.sql`
- Create: `packages/control-db/migrations/0009_stripe_webhook_events.sql`
- Create: `infrastructure/provisioning/apply-control-migrations.ts`

### Steps

- [ ] **Step 1.1: Create new Supabase project via Management API**

```bash
# In repo root. Token comes from /tmp/new-supabase-creds.txt or your Supabase dashboard.
SUPABASE_PAT="sbp_..."
ORG_ID="dhtcfucofmyxmombopex"   # gathertaiwan's Org
DB_PASS=$(openssl rand -hex 24)
echo "$DB_PASS" > /tmp/control-db-password.txt
chmod 600 /tmp/control-db-password.txt

curl -s -X POST -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" \
  -H "User-Agent: provision-control/1.0" \
  -d "{\"organization_id\":\"$ORG_ID\",\"name\":\"platform-control\",\"region\":\"ap-northeast-1\",\"db_pass\":\"$DB_PASS\"}" \
  https://api.supabase.com/v1/projects | tee /tmp/control-project.json
```

Expected: JSON with `"id":"<ref>"`, `"name":"platform-control"`, `"region":"ap-northeast-1"`, `"status":"ACTIVE_HEALTHY"`.

- [ ] **Step 1.2: Save project ref + fetch keys**

```bash
CONTROL_REF=$(jq -r .ref /tmp/control-project.json)
echo "CONTROL_REF=$CONTROL_REF"

curl -s -H "Authorization: Bearer $SUPABASE_PAT" -H "User-Agent: provision-control/1.0" \
  https://api.supabase.com/v1/projects/$CONTROL_REF/api-keys \
  | jq -r '.[] | select(.type=="legacy") | "\(.name): \(.api_key)"' \
  | tee /tmp/control-keys.txt
```

Expected: `anon: eyJ...`, `service_role: eyJ...` printed and saved.

- [ ] **Step 1.3: Write migration 0001 — platform_users**

Create `packages/control-db/migrations/0001_platform_users.sql`:

```sql
create extension if not exists "pgcrypto";

create table platform_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  stripe_customer_id text unique,
  created_at timestamptz default now()
);

comment on table platform_users is 'Platform-level accounts (operators + paying customers as billing entities). Distinct from per-tenant Supabase Auth users.';
```

- [ ] **Step 1.4: Write migration 0002 — tenants**

Create `packages/control-db/migrations/0002_tenants.sql`:

```sql
create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  custom_domain text unique,
  custom_domain_verified_at timestamptz,
  status text not null check (status in (
    'pending_payment', 'provisioning', 'active', 'suspended', 'canceled', 'failed'
  )),
  owner_user_id uuid references platform_users(id) not null,
  plan text check (plan in ('starter', 'standard', 'pro')),
  deploy_pin_commit text,
  created_at timestamptz default now(),
  activated_at timestamptz,
  suspended_at timestamptz,
  suspended_reason text
);

create index on tenants (status);
create index on tenants (owner_user_id);
```

- [ ] **Step 1.5: Write migration 0003 — tenant_infrastructure**

Create `packages/control-db/migrations/0003_tenant_infrastructure.sql`:

```sql
create table tenant_infrastructure (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  vercel_project_id text not null,
  vercel_deployment_url text,
  railway_project_id text not null,
  railway_api_service_id text not null,
  railway_api_url text,
  railway_mcp_service_id text not null,
  railway_mcp_url text,
  supabase_project_ref text not null,
  supabase_url text not null,
  supabase_anon_key text not null,
  supabase_service_role_key_encrypted bytea not null,
  resend_domain_id text,
  resend_dkim_verified_at timestamptz,
  cloudflare_zone_id text,
  mcp_token_hash text,
  created_at timestamptz default now()
);

comment on column tenant_infrastructure.supabase_service_role_key_encrypted is
  'aes-256-gcm encrypted with PLATFORM_KEK. Format: 12-byte IV || ciphertext || 16-byte auth tag.';
```

- [ ] **Step 1.6: Write migration 0004 — tenant_modules**

Create `packages/control-db/migrations/0004_tenant_modules.sql`:

```sql
create table tenant_modules (
  tenant_id uuid references tenants(id) on delete cascade,
  module text not null,
  enabled boolean default false,
  config jsonb default '{}'::jsonb,
  enabled_at timestamptz,
  primary key (tenant_id, module)
);
```

- [ ] **Step 1.7: Write migration 0005 — provisioning_jobs**

Create `packages/control-db/migrations/0005_provisioning_jobs.sql`:

```sql
create table provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  step text not null,
  status text not null check (status in ('queued', 'running', 'success', 'failed')),
  attempt int default 0,
  last_error text,
  payload jsonb,
  result jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz default now()
);

create index on provisioning_jobs (tenant_id, created_at);
create index on provisioning_jobs (status) where status in ('queued', 'failed');
```

- [ ] **Step 1.8: Write migration 0006 — audit_log**

Create `packages/control-db/migrations/0006_audit_log.sql`:

```sql
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id),
  actor_type text not null check (actor_type in ('platform_admin', 'customer_agent', 'system', 'customer_user')),
  actor_id text,
  action text not null,
  resource text,
  payload jsonb,
  created_at timestamptz default now()
);

create index on audit_log (tenant_id, created_at desc);
create index on audit_log (actor_type, created_at desc);
```

- [ ] **Step 1.9: Write migration 0007 — tenant_health_log**

Create `packages/control-db/migrations/0007_tenant_health_log.sql`:

```sql
create table tenant_health_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id),
  checked_at timestamptz default now(),
  vercel_ok boolean,
  api_ok boolean,
  mcp_ok boolean,
  supabase_ok boolean,
  details jsonb
);

create index on tenant_health_log (tenant_id, checked_at desc);
```

- [ ] **Step 1.10: Write migration 0008 — billing_subscriptions**

Create `packages/control-db/migrations/0008_billing_subscriptions.sql`:

```sql
create table billing_subscriptions (
  id text primary key,
  tenant_id uuid references tenants(id) on delete set null,
  status text,
  plan text,
  current_period_end timestamptz,
  raw jsonb,
  updated_at timestamptz default now()
);

create index on billing_subscriptions (tenant_id);
```

- [ ] **Step 1.11: Write migration 0009 — stripe_webhook_events**

Create `packages/control-db/migrations/0009_stripe_webhook_events.sql`:

```sql
create table stripe_webhook_events (
  event_id text primary key,
  type text,
  payload jsonb,
  processed_at timestamptz default now()
);
```

- [ ] **Step 1.12: Write `infrastructure/provisioning/apply-control-migrations.ts`**

Create `infrastructure/provisioning/apply-control-migrations.ts`:

```typescript
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const TOKEN = process.env.SUPABASE_PAT
const REF = process.env.CONTROL_DB_REF
if (!TOKEN || !REF) {
  console.error("Set SUPABASE_PAT and CONTROL_DB_REF")
  process.exit(1)
}

const MIGRATIONS_DIR = join(__dirname, "..", "..", "packages", "control-db", "migrations")
const HEADERS = {
  "Authorization": `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
  "User-Agent": "control-migrations/1.0",
}

async function runSql(query: string, label: string) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${REF}/database/query`,
    { method: "POST", headers: HEADERS, body: JSON.stringify({ query }) },
  )
  if (!res.ok) {
    console.error(`✗ ${label}: ${await res.text()}`)
    process.exit(1)
  }
  console.log(`✓ ${label}`)
}

const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort()
for (const f of files) {
  await runSql(readFileSync(join(MIGRATIONS_DIR, f), "utf8"), f)
}

// Verify
await runSql(
  "select tablename from pg_tables where schemaname='public' order by tablename",
  "verify schema",
)
console.log("✓ control DB ready")
```

- [ ] **Step 1.13: Run the migration script**

```bash
cd /Users/cataholic/.gemini/File/G
SUPABASE_PAT="sbp_..." CONTROL_DB_REF="$CONTROL_REF" npx tsx infrastructure/provisioning/apply-control-migrations.ts
```

Expected output: `✓ 0001_platform_users.sql` ... `✓ 0009_stripe_webhook_events.sql` ... `✓ control DB ready`.

- [ ] **Step 1.14: Verify table count**

```bash
curl -s -X POST -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" -H "User-Agent: provision-control/1.0" \
  -d '{"query":"select count(*)::int from pg_tables where schemaname='\''public'\''"}' \
  https://api.supabase.com/v1/projects/$CONTROL_REF/database/query
```

Expected: `[{"count":9}]`.

- [ ] **Step 1.15: Commit**

```bash
git checkout -b plan/phase-a-1-control-db-schema
git add packages/control-db/migrations/ infrastructure/provisioning/apply-control-migrations.ts
git commit -m "feat(control-db): bootstrap platform-control schema (9 tables)

Adds packages/control-db/migrations/0001..0009 covering platform_users,
tenants, tenant_infrastructure, tenant_modules, provisioning_jobs,
audit_log, tenant_health_log, billing_subscriptions,
stripe_webhook_events. Runner script applies them via Supabase
Management API.

Schema is per spec docs/superpowers/specs/2026-05-10-multi-tenant-platform-foundation-design.md §4."
git push -u origin plan/phase-a-1-control-db-schema
gh pr create --base main --title "Phase A-1: control-db schema" \
  --body "Implements §4 of the multi-tenant foundation spec: 9 control plane tables created in a new Tokyo Supabase project (platform-control). Schema applied via Mgmt API. Tested by counting tables (=9) post-migration."
```

---

## Task 2 (PR-A2): packages/control-db library + encryption

**Goal:** Typed Supabase client, AES-256-GCM encryption helpers, query helpers for tenants/jobs/audit/health. Unit tests for encryption (round-trip, tampering detection).

**Files:**
- Create: `packages/control-db/package.json`
- Create: `packages/control-db/tsconfig.json`
- Create: `packages/control-db/src/index.ts`
- Create: `packages/control-db/src/client.ts`
- Create: `packages/control-db/src/crypto.ts`
- Create: `packages/control-db/src/types.ts`
- Create: `packages/control-db/src/queries/tenants.ts`
- Create: `packages/control-db/src/queries/jobs.ts`
- Create: `packages/control-db/src/queries/audit.ts`
- Create: `packages/control-db/src/queries/health.ts`
- Create: `packages/control-db/__tests__/crypto.test.ts`
- Modify: root `package.json` (workspace globs)
- Modify: `turbo.json` (add packages/control-db to test pipeline)

### Steps

- [ ] **Step 2.1: Create package.json**

Create `packages/control-db/package.json`:

```json
{
  "name": "@realreal/control-db",
  "version": "1.0.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2"
  },
  "devDependencies": {
    "typescript": "^5",
    "vitest": "^4"
  }
}
```

- [ ] **Step 2.2: Create tsconfig**

Create `packages/control-db/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "lib": ["ES2022"]
  },
  "include": ["src/**/*", "__tests__/**/*"]
}
```

- [ ] **Step 2.3: Add workspace + turbo entries**

Modify root `package.json`. The `workspaces` already covers `packages/*`, no change needed if `packages/control-db` is under that. Verify with:

```bash
cd /Users/cataholic/.gemini/File/G
node -e "console.log(JSON.parse(require('fs').readFileSync('package.json')).workspaces)"
```

Expected output includes `packages/*`. If yes, skip; if no, add it.

Modify `turbo.json` — no change required because `test` task already runs across all workspace packages.

- [ ] **Step 2.4: Write the failing crypto test**

Create `packages/control-db/__tests__/crypto.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { encrypt, decrypt } from "../src/crypto"

const KEK = Buffer.from("0".repeat(64), "hex")  // 32 zero bytes for tests

describe("crypto", () => {
  it("encrypt then decrypt round-trips the plaintext", () => {
    const plain = "supabase_service_role_key_xxxxx"
    const cipher = encrypt(plain, KEK)
    const back = decrypt(cipher, KEK)
    expect(back).toBe(plain)
  })

  it("decrypting with wrong key throws", () => {
    const cipher = encrypt("hello", KEK)
    const wrong = Buffer.from("1".repeat(64), "hex")
    expect(() => decrypt(cipher, wrong)).toThrow()
  })

  it("decrypting tampered ciphertext throws (auth tag check)", () => {
    const cipher = encrypt("hello", KEK)
    cipher[cipher.length - 1] ^= 1  // flip last byte
    expect(() => decrypt(cipher, KEK)).toThrow()
  })

  it("emits 12-byte IV prefix", () => {
    const cipher = encrypt("x", KEK)
    expect(cipher.length).toBeGreaterThanOrEqual(12 + 1 + 16)  // IV + ciphertext + tag
  })
})
```

- [ ] **Step 2.5: Run the test, expect failure**

```bash
cd /Users/cataholic/.gemini/File/G/packages/control-db
npx vitest run __tests__/crypto.test.ts
```

Expected: 4 tests fail with "Cannot find module '../src/crypto'".

- [ ] **Step 2.6: Implement crypto.ts**

Create `packages/control-db/src/crypto.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGO = "aes-256-gcm"
const IV_LEN = 12
const TAG_LEN = 16

/** Encrypt plaintext with a 32-byte KEK. Returns IV || ciphertext || authTag. */
export function encrypt(plaintext: string, kek: Buffer): Buffer {
  if (kek.length !== 32) throw new Error("KEK must be 32 bytes")
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, kek, iv)
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, ct, tag])
}

/** Decrypt blob produced by encrypt(). Throws on tag mismatch / wrong key. */
export function decrypt(blob: Buffer, kek: Buffer): string {
  if (kek.length !== 32) throw new Error("KEK must be 32 bytes")
  if (blob.length < IV_LEN + TAG_LEN + 1) throw new Error("blob too short")
  const iv = blob.subarray(0, IV_LEN)
  const tag = blob.subarray(blob.length - TAG_LEN)
  const ct = blob.subarray(IV_LEN, blob.length - TAG_LEN)
  const decipher = createDecipheriv(ALGO, kek, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8")
}

/** Parse `PLATFORM_KEK` env var (hex-encoded 32 bytes) into a Buffer. */
export function loadKek(): Buffer {
  const v = process.env.PLATFORM_KEK
  if (!v) throw new Error("PLATFORM_KEK not set")
  const buf = Buffer.from(v, "hex")
  if (buf.length !== 32) throw new Error("PLATFORM_KEK must be 32 hex bytes (64 chars)")
  return buf
}
```

- [ ] **Step 2.7: Run tests, expect pass**

```bash
npx vitest run __tests__/crypto.test.ts
```

Expected: 4 passed.

- [ ] **Step 2.8: Implement types.ts**

Create `packages/control-db/src/types.ts`:

```typescript
export type TenantStatus =
  | "pending_payment"
  | "provisioning"
  | "active"
  | "suspended"
  | "canceled"
  | "failed"

export type ActorType = "platform_admin" | "customer_agent" | "system" | "customer_user"

export type ProvisioningStep =
  | "validate"
  | "supabase_setup"
  | "resend_setup"
  | "cloudflare_dns"
  | "vercel_setup"
  | "railway_setup"
  | "domain_finalize"
  | "tenant_finalize"

export type JobStatus = "queued" | "running" | "success" | "failed"

export interface Tenant {
  id: string
  slug: string
  custom_domain: string | null
  status: TenantStatus
  owner_user_id: string
  plan: string | null
  created_at: string
  activated_at: string | null
}

export interface ProvisioningJob {
  id: string
  tenant_id: string
  step: ProvisioningStep
  status: JobStatus
  attempt: number
  last_error: string | null
  payload: unknown
  result: unknown
  created_at: string
  finished_at: string | null
}

export interface AuditEntry {
  tenant_id: string | null
  actor_type: ActorType
  actor_id: string | null
  action: string
  resource: string | null
  payload: unknown
}

export interface HealthRow {
  tenant_id: string
  checked_at: string
  vercel_ok: boolean
  api_ok: boolean
  mcp_ok: boolean
  supabase_ok: boolean
  details: unknown
}
```

- [ ] **Step 2.9: Implement client.ts**

Create `packages/control-db/src/client.ts`:

```typescript
import { createClient, SupabaseClient } from "@supabase/supabase-js"

export function createControlClient(): SupabaseClient {
  const url = process.env.CONTROL_DB_URL
  const key = process.env.CONTROL_DB_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("CONTROL_DB_URL and CONTROL_DB_SERVICE_ROLE_KEY required")
  return createClient(url, key, { auth: { persistSession: false } })
}
```

- [ ] **Step 2.10: Implement queries/tenants.ts**

Create `packages/control-db/src/queries/tenants.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Tenant } from "../types"

export async function listActiveTenants(c: SupabaseClient): Promise<Tenant[]> {
  const { data, error } = await c.from("tenants").select("*").eq("status", "active").order("created_at")
  if (error) throw error
  return (data ?? []) as Tenant[]
}

export async function getTenant(c: SupabaseClient, id: string): Promise<Tenant | null> {
  const { data, error } = await c.from("tenants").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as Tenant | null) ?? null
}

export async function getTenantBySlug(c: SupabaseClient, slug: string): Promise<Tenant | null> {
  const { data, error } = await c.from("tenants").select("*").eq("slug", slug).maybeSingle()
  if (error) throw error
  return (data as Tenant | null) ?? null
}
```

- [ ] **Step 2.11: Implement queries/jobs.ts**

Create `packages/control-db/src/queries/jobs.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js"
import type { JobStatus, ProvisioningJob, ProvisioningStep } from "../types"

export async function claimQueuedJob(c: SupabaseClient): Promise<ProvisioningJob | null> {
  // Atomically claim a queued job by updating status to 'running'.
  const { data, error } = await c.rpc("claim_queued_job")
  if (error) throw error
  return (data as ProvisioningJob | null) ?? null
}

export async function listJobsForTenant(c: SupabaseClient, tenantId: string): Promise<ProvisioningJob[]> {
  const { data, error } = await c.from("provisioning_jobs").select("*")
    .eq("tenant_id", tenantId).order("created_at")
  if (error) throw error
  return (data ?? []) as ProvisioningJob[]
}

export async function markJobStatus(
  c: SupabaseClient,
  id: string,
  status: JobStatus,
  patch: { last_error?: string; result?: unknown } = {},
) {
  const update: Record<string, unknown> = { status }
  if (status === "success" || status === "failed") update.finished_at = new Date().toISOString()
  if (patch.last_error !== undefined) update.last_error = patch.last_error
  if (patch.result !== undefined) update.result = patch.result
  const { error } = await c.from("provisioning_jobs").update(update).eq("id", id)
  if (error) throw error
}

export async function enqueueJobs(
  c: SupabaseClient,
  tenantId: string,
  steps: ProvisioningStep[],
) {
  const rows = steps.map(step => ({ tenant_id: tenantId, step, status: "queued" as JobStatus }))
  const { error } = await c.from("provisioning_jobs").insert(rows)
  if (error) throw error
}
```

The `claim_queued_job` RPC is created in **Step 2.12**.

- [ ] **Step 2.12: Add `claim_queued_job` SQL function (migration 0010)**

Create `packages/control-db/migrations/0010_claim_queued_job.sql`:

```sql
create or replace function claim_queued_job() returns provisioning_jobs as $$
declare
  job provisioning_jobs;
begin
  update provisioning_jobs
  set status = 'running',
      attempt = attempt + 1,
      started_at = now()
  where id = (
    select id from provisioning_jobs
    where status = 'queued'
    order by created_at
    for update skip locked
    limit 1
  )
  returning * into job;
  return job;
end;
$$ language plpgsql security definer;
```

- [ ] **Step 2.13: Apply migration 0010**

```bash
cd /Users/cataholic/.gemini/File/G
SUPABASE_PAT="sbp_..." CONTROL_DB_REF="$CONTROL_REF" npx tsx infrastructure/provisioning/apply-control-migrations.ts
```

Expected: existing 9 migrations run idempotently (no-op on already-existing tables; the file SQL contains `create table` without `if not exists` — see note below), plus `✓ 0010_claim_queued_job.sql`.

Note: Re-running 0001..0009 after they've already been applied **will fail** because `create table` is not idempotent. Add `if not exists` to all create statements OR wrap the runner script to track applied migrations. Choose **Option A: add `if not exists`** since it's simpler and harmless:

- [ ] **Step 2.14: Make 0001..0009 idempotent (one-time edit)**

For each of `packages/control-db/migrations/0001..0009`, replace `create table` with `create table if not exists` and `create index` with `create index if not exists`. Use sed:

```bash
cd /Users/cataholic/.gemini/File/G/packages/control-db/migrations
for f in 0001*.sql 0002*.sql 0003*.sql 0004*.sql 0005*.sql 0006*.sql 0007*.sql 0008*.sql 0009*.sql; do
  sed -i.bak -e 's/^create table /create table if not exists /' \
             -e 's/^create index /create index if not exists /' "$f"
  rm "$f.bak"
done
git diff
```

Expected: every `create table` and `create index` now has `if not exists`. Re-run **Step 2.13** to confirm zero errors.

- [ ] **Step 2.15: Implement queries/audit.ts**

Create `packages/control-db/src/queries/audit.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuditEntry } from "../types"

export async function emitAudit(c: SupabaseClient, e: AuditEntry): Promise<void> {
  const { error } = await c.from("audit_log").insert(e)
  if (error) throw error
}

export async function listAuditForTenant(c: SupabaseClient, tenantId: string, limit = 100) {
  const { data, error } = await c.from("audit_log").select("*")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(limit)
  if (error) throw error
  return data ?? []
}

export async function listAuditAll(c: SupabaseClient, limit = 200) {
  const { data, error } = await c.from("audit_log").select("*")
    .order("created_at", { ascending: false }).limit(limit)
  if (error) throw error
  return data ?? []
}
```

- [ ] **Step 2.16: Implement queries/health.ts**

Create `packages/control-db/src/queries/health.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js"
import type { HealthRow } from "../types"

export async function recordHealth(c: SupabaseClient, row: Omit<HealthRow, "checked_at">) {
  const { error } = await c.from("tenant_health_log").insert(row)
  if (error) throw error
}

export async function recentHealth(c: SupabaseClient, tenantId: string, hours = 24): Promise<HealthRow[]> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString()
  const { data, error } = await c.from("tenant_health_log").select("*")
    .eq("tenant_id", tenantId).gte("checked_at", since).order("checked_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as HealthRow[]
}

export async function consecutiveFailures(c: SupabaseClient, tenantId: string): Promise<number> {
  const recent = await recentHealth(c, tenantId, 1)
  let streak = 0
  for (const r of recent) {
    if (r.vercel_ok && r.api_ok && r.mcp_ok && r.supabase_ok) break
    streak++
  }
  return streak
}
```

- [ ] **Step 2.17: Implement index.ts barrel**

Create `packages/control-db/src/index.ts`:

```typescript
export * from "./client"
export * from "./crypto"
export * from "./types"
export * as tenants from "./queries/tenants"
export * as jobs from "./queries/jobs"
export * as audit from "./queries/audit"
export * as health from "./queries/health"
```

- [ ] **Step 2.18: Run typecheck**

```bash
cd /Users/cataholic/.gemini/File/G/packages/control-db
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2.19: Run tests**

```bash
npx vitest run
```

Expected: 4 passed (crypto round-trip, wrong key, tampering, IV prefix length).

- [ ] **Step 2.20: Commit**

```bash
cd /Users/cataholic/.gemini/File/G
git checkout -b plan/phase-a-2-control-db-lib
git add packages/control-db/
git commit -m "feat(control-db): typed client + AES-256-GCM encryption + queries

Adds packages/control-db/{client.ts,crypto.ts,types.ts} and
queries/{tenants,jobs,audit,health}.ts. AES-256-GCM with 12-byte IV
+ 16-byte auth tag, KEK loaded from PLATFORM_KEK env. Adds
claim_queued_job() PG function via migration 0010 (FOR UPDATE SKIP
LOCKED). 4 unit tests for crypto."
git push -u origin plan/phase-a-2-control-db-lib
gh pr create --base main --title "Phase A-2: control-db library" --body "..."
```

---

## Task 3 (PR-A3): Tenant DB migrations 0015–0020 + apply to realreal

**Goal:** New tenant-DB schema additions land in `packages/db/migrations/`, are applied to the existing realreal Supabase, and the realreal site continues to function unchanged.

**Files:**
- Create: `packages/db/migrations/0015_schema_migrations.sql`
- Create: `packages/db/migrations/0016_courses_schema.sql`
- Create: `packages/db/migrations/0017_crowdfund_schema.sql`
- Create: `packages/db/migrations/0018_booking_schema.sql`
- Create: `packages/db/migrations/0019_config_history.sql`
- Create: `packages/db/migrations/0020_brand_seed.sql`
- Create: `infrastructure/provisioning/apply-tenant-migrations.ts`

### Steps

- [ ] **Step 3.1: Migration 0015 — schema_migrations**

Create `packages/db/migrations/0015_schema_migrations.sql`:

```sql
create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz default now()
);

-- Backfill: realreal already had 0001..0014 applied historically. Mark them as applied.
insert into schema_migrations (filename) values
  ('0001_initial.sql'),
  ('0002_catalog_search.sql'),
  ('0003_invoice_extensions.sql'),
  ('0004_subscription_plans_seed.sql'),
  ('0005_cms_tables.sql'),
  ('0006_campaigns_tier_marketing.sql'),
  ('0007_wp_membership_data.sql'),
  ('0008_product_reviews.sql'),
  ('0009_product_detail_columns.sql'),
  ('0009_seed_products.sql'),
  ('0010_stock_deduction_rpc.sql'),
  ('0011_campaign_promo_types.sql'),
  ('0012_email_templates.sql'),
  ('0013_product_excerpt.sql'),
  ('0014_storage_rls.sql')
on conflict do nothing;
```

- [ ] **Step 3.2: Migration 0016 — courses schema**

Create `packages/db/migrations/0016_courses_schema.sql`:

```sql
create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique not null,
  description text,
  cover_image text,
  price numeric(10,2),
  is_published boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists course_lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  title text not null,
  slug text not null,
  video_url text,
  content_md text,
  position int not null default 0,
  created_at timestamptz default now(),
  unique (course_id, slug)
);

create table if not exists course_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  enrolled_at timestamptz default now(),
  completed_at timestamptz,
  unique (user_id, course_id)
);

create table if not exists lesson_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references course_lessons(id) on delete cascade,
  watched_seconds int default 0,
  completed_at timestamptz,
  primary key (user_id, lesson_id)
);

create index if not exists course_lessons_course_pos_idx on course_lessons (course_id, position);
create index if not exists course_enrollments_user_idx on course_enrollments (user_id);

insert into schema_migrations (filename) values ('0016_courses_schema.sql') on conflict do nothing;
```

- [ ] **Step 3.3: Migration 0017 — crowdfund schema**

Create `packages/db/migrations/0017_crowdfund_schema.sql`:

```sql
create table if not exists crowdfund_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique not null,
  description text,
  cover_image text,
  goal_amount numeric(12,2) not null,
  raised_amount numeric(12,2) default 0,
  deadline timestamptz not null,
  status text not null check (status in ('draft', 'active', 'funded', 'failed', 'canceled')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists crowdfund_tiers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references crowdfund_projects(id) on delete cascade,
  title text not null,
  price numeric(10,2) not null,
  description text,
  max_pledges int,
  current_pledges int default 0
);

create table if not exists crowdfund_pledges (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references crowdfund_projects(id) on delete cascade,
  tier_id uuid references crowdfund_tiers(id) on delete set null,
  user_id uuid not null references auth.users(id),
  amount numeric(10,2) not null,
  status text not null check (status in ('reserved', 'captured', 'refunded', 'failed')),
  captured_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists crowdfund_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references crowdfund_projects(id) on delete cascade,
  title text not null,
  body_md text,
  posted_at timestamptz default now()
);

create index if not exists crowdfund_pledges_project_idx on crowdfund_pledges (project_id);

insert into schema_migrations (filename) values ('0017_crowdfund_schema.sql') on conflict do nothing;
```

- [ ] **Step 3.4: Migration 0018 — booking schema**

Create `packages/db/migrations/0018_booking_schema.sql`:

```sql
create table if not exists booking_services (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique not null,
  description text,
  duration_minutes int not null,
  price numeric(10,2),
  capacity int default 1,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists booking_slots (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references booking_services(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  capacity int not null,
  booked int default 0
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references booking_slots(id),
  user_id uuid references auth.users(id),
  status text not null check (status in ('pending', 'confirmed', 'canceled', 'completed', 'no_show')),
  customer_phone text,
  notes text,
  created_at timestamptz default now()
);

create index if not exists booking_slots_service_start_idx on booking_slots (service_id, start_at);
create index if not exists bookings_user_idx on bookings (user_id);

insert into schema_migrations (filename) values ('0018_booking_schema.sql') on conflict do nothing;
```

- [ ] **Step 3.5: Migration 0019 — config_history**

Create `packages/db/migrations/0019_config_history.sql`:

```sql
create table if not exists config_history (
  id uuid primary key default gen_random_uuid(),
  changed_by uuid references auth.users(id),
  config_key text not null,
  old_value jsonb,
  new_value jsonb,
  changed_at timestamptz default now()
);

create index if not exists config_history_key_idx on config_history (config_key, changed_at desc);

-- Trigger: auto-write config_history when site_contents.value changes
create or replace function log_site_contents_change() returns trigger as $$
begin
  if new.value is distinct from old.value then
    insert into config_history (config_key, old_value, new_value, changed_by)
    values (
      'site_contents.' || new.key,
      old.value,
      new.value,
      coalesce((current_setting('request.jwt.claims', true)::json->>'sub')::uuid, null)
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists site_contents_history_trigger on site_contents;
create trigger site_contents_history_trigger
  after update on site_contents
  for each row execute function log_site_contents_change();

insert into schema_migrations (filename) values ('0019_config_history.sql') on conflict do nothing;
```

- [ ] **Step 3.6: Migration 0020 — brand + module_config seed**

Create `packages/db/migrations/0020_brand_seed.sql`:

```sql
-- Seed default brand (overridden at provisioning time per-tenant)
insert into site_contents (key, value)
values (
  'brand',
  '{
    "name": "RealReal",
    "tagline": "純淨植物力，為你的健康加分",
    "logo_url": "/logo.svg",
    "favicon_url": "/favicon.ico",
    "colors": {
      "primary": "#4a7c59",
      "primary_foreground": "#ffffff",
      "accent": "#e8b923",
      "background": "#fafafa",
      "foreground": "#2d3436"
    },
    "font_family": "geist"
  }'::jsonb
)
on conflict (key) do nothing;

-- Seed module_config with current realreal modules ON, derivative modules OFF
insert into site_contents (key, value)
values (
  'module_config',
  '{
    "subscriptions": true,
    "membership_tiers": true,
    "campaigns": true,
    "product_reviews": true,
    "cms_posts": true,
    "site_notice": true,
    "member_only_products": false,
    "courses": false,
    "crowdfunding": false,
    "bookings": false
  }'::jsonb
)
on conflict (key) do nothing;

insert into schema_migrations (filename) values ('0020_brand_seed.sql') on conflict do nothing;
```

- [ ] **Step 3.7: Write the tenant migration runner**

Create `infrastructure/provisioning/apply-tenant-migrations.ts`:

```typescript
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const TOKEN = process.env.SUPABASE_PAT
const REF = process.env.TENANT_DB_REF
if (!TOKEN || !REF) { console.error("Set SUPABASE_PAT and TENANT_DB_REF"); process.exit(1) }

const DIR = join(__dirname, "..", "..", "packages", "db", "migrations")
const HEADERS = {
  "Authorization": `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
  "User-Agent": "tenant-migrations/1.0",
}

async function sql(query: string, label: string) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,
    { method: "POST", headers: HEADERS, body: JSON.stringify({ query }) })
  if (!r.ok) { console.error(`✗ ${label}: ${await r.text()}`); process.exit(1) }
  return r.json()
}

// Find missing migrations
const files = readdirSync(DIR).filter(f => f.endsWith(".sql")).sort()
const applied = await sql(
  "select filename from schema_migrations",
  "list applied",
).then((rows: { filename: string }[]) => new Set(rows.map(r => r.filename)))
  .catch(() => new Set<string>())  // table may not exist yet (first run)

for (const f of files) {
  if (applied.has(f)) { console.log(`- skip ${f} (already applied)`); continue }
  await sql(readFileSync(join(DIR, f), "utf8"), f)
  console.log(`✓ ${f}`)
}
console.log("✓ tenant migrations up to date")
```

- [ ] **Step 3.8: Apply migrations to realreal Supabase**

```bash
cd /Users/cataholic/.gemini/File/G
SUPABASE_PAT="sbp_..." TENANT_DB_REF="ozwftlkgqmewtadypsfi" \
  npx tsx infrastructure/provisioning/apply-tenant-migrations.ts
```

Expected output (showing 0015..0020 applied, others skipped because schema_migrations seeds them as already applied):

```
✓ 0015_schema_migrations.sql       <-- creates tracking table + backfills 0001-0014
- skip 0001_initial.sql (already applied)
... (all of 0001-0014 skipped)
✓ 0016_courses_schema.sql
✓ 0017_crowdfund_schema.sql
✓ 0018_booking_schema.sql
✓ 0019_config_history.sql
✓ 0020_brand_seed.sql
✓ tenant migrations up to date
```

Note the order: the runner sorts filenames, so 0015 runs before 0016. But 0015 also backfills 0001-0014. After 0015 runs, the loop's `applied` Set is stale — the runner needs to refetch OR we accept that 0001-0014 will be re-attempted. Since they're idempotent (`create table` failed before — oh wait, 0001-0014 are NOT idempotent the same way control-db wasn't).

To avoid re-running 0001-0014, the runner needs to refetch `applied` after 0015. Update the runner:

- [ ] **Step 3.9: Fix the runner to refetch after 0015**

Edit `infrastructure/provisioning/apply-tenant-migrations.ts` to refetch the applied set after each migration:

```typescript
// ... (replace the loop at the bottom)

for (const f of files) {
  // Re-check on each iteration so 0015's backfill takes effect
  const applied = await sql(
    "select filename from schema_migrations",
    "list applied",
  ).then((rows: { filename: string }[]) => new Set(rows.map(r => r.filename)))
    .catch(() => new Set<string>())

  if (applied.has(f)) { console.log(`- skip ${f} (already applied)`); continue }
  await sql(readFileSync(join(DIR, f), "utf8"), f)
  console.log(`✓ ${f}`)
}
```

- [ ] **Step 3.10: Re-run apply on realreal**

```bash
SUPABASE_PAT="sbp_..." TENANT_DB_REF="ozwftlkgqmewtadypsfi" \
  npx tsx infrastructure/provisioning/apply-tenant-migrations.ts
```

Expected: 0015 applies (creates the table + backfill), then 0001-0014 all skip, then 0016-0020 each apply.

- [ ] **Step 3.11: Verify on realreal**

```bash
SUPABASE_PAT="sbp_..." curl -s -X POST -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" -H "User-Agent: verify/1.0" \
  -d '{"query":"select count(*) from schema_migrations"}' \
  https://api.supabase.com/v1/projects/ozwftlkgqmewtadypsfi/database/query
```

Expected: `[{"count":21}]` (15 historical 0001-0014 + new 0015..0020).

```bash
curl -s -X POST -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" -H "User-Agent: verify/1.0" \
  -d "{\"query\":\"select tablename from pg_tables where schemaname='public' and tablename in ('courses','crowdfund_projects','booking_services','config_history','schema_migrations') order by tablename\"}" \
  https://api.supabase.com/v1/projects/ozwftlkgqmewtadypsfi/database/query
```

Expected: 5 rows.

- [ ] **Step 3.12: Smoke-test realreal frontend still works**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://agent-web-xi.vercel.app/
curl -s -o /dev/null -w "%{http_code}\n" https://api-production-ed3c.up.railway.app/health
curl -s "https://api-production-ed3c.up.railway.app/products?limit=1" | python3 -m json.tool | head -5
```

Expected: `200`, `200`, valid JSON with at least one product. If anything is non-200, **STOP** and investigate before merging the PR — these migrations could be breaking realreal.

- [ ] **Step 3.13: Commit**

```bash
cd /Users/cataholic/.gemini/File/G
git checkout -b plan/phase-a-3-tenant-migrations
git add packages/db/migrations/0015_*.sql \
        packages/db/migrations/0016_*.sql \
        packages/db/migrations/0017_*.sql \
        packages/db/migrations/0018_*.sql \
        packages/db/migrations/0019_*.sql \
        packages/db/migrations/0020_*.sql \
        infrastructure/provisioning/apply-tenant-migrations.ts
git commit -m "feat(db): add tenant migrations 0015-0020 (multi-tenant foundation)

- 0015_schema_migrations: tracking table + backfill of 0001-0014 history
- 0016_courses_schema: courses, lessons, enrollments, progress
- 0017_crowdfund_schema: projects, tiers, pledges, updates
- 0018_booking_schema: services, slots, bookings
- 0019_config_history: site_contents change history + trigger
- 0020_brand_seed: default brand + module_config (current modules ON,
  derivative modules OFF)

Applied to realreal Supabase (ozwftlkgqmewtadypsfi). Frontend (200)
and /products endpoint smoke-tested post-migration; no regression.

Per spec §5."
git push -u origin plan/phase-a-3-tenant-migrations
gh pr create --base main --title "Phase A-3: tenant migrations 0015-0020" --body "..."
```

---

## Task 4 (PR-A4): apps/workers skeleton (HTTP server + cron framework + audit endpoint)

**Goal:** A new Railway service that exposes (a) `/health`, (b) `/internal/audit` (HMAC-signed), (c) a Stripe webhook receiver that records `event_id` for idempotency only (full handlers in Phase D), (d) a job runner loop that polls but has no handlers yet (logs claim/skip), (e) a cron scheduler with three skeleton tasks (health-check, dkim-verify, stripe-sync). Skeletons return early; full implementation lives in Phase D / E.

**Files:**
- Create: `apps/workers/package.json`
- Create: `apps/workers/tsconfig.json`
- Create: `apps/workers/railway.toml`
- Create: `apps/workers/src/index.ts`
- Create: `apps/workers/src/lib/hmac.ts`
- Create: `apps/workers/src/routes/audit.ts`
- Create: `apps/workers/src/webhooks/stripe.ts`
- Create: `apps/workers/src/jobs/runner.ts`
- Create: `apps/workers/src/cron/health-check.ts`
- Create: `apps/workers/src/cron/resend-dkim-verify.ts`
- Create: `apps/workers/src/cron/stripe-sync.ts`
- Create: `apps/workers/__tests__/hmac.test.ts`
- Create: `apps/workers/__tests__/audit-route.test.ts`

### Steps

- [ ] **Step 4.1: package.json**

Create `apps/workers/package.json`:

```json
{
  "name": "workers",
  "version": "1.0.0",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@realreal/control-db": "*",
    "@supabase/supabase-js": "^2",
    "express": "^5",
    "node-cron": "^3",
    "pino": "^10",
    "stripe": "^17"
  },
  "devDependencies": {
    "@types/express": "^5",
    "@types/node": "^20",
    "@types/node-cron": "^3",
    "supertest": "^7",
    "@types/supertest": "^7",
    "tsx": "^4",
    "typescript": "^5",
    "vitest": "^4"
  }
}
```

- [ ] **Step 4.2: tsconfig.json**

Create `apps/workers/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "lib": ["ES2022"],
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4.3: railway.toml**

Create `apps/workers/railway.toml`:

```toml
[build]
builder = "NIXPACKS"
buildCommand = "npm run build"

[deploy]
startCommand = "npm run start"
healthcheckPath = "/health"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

- [ ] **Step 4.4: Write failing test for hmac**

Create `apps/workers/__tests__/hmac.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { sign, verify } from "../src/lib/hmac"

const SECRET = "test-secret-32-bytes-aaaaaaaaaa"

describe("hmac", () => {
  it("sign + verify round-trip succeeds", () => {
    const payload = '{"foo":"bar"}'
    const sig = sign(payload, SECRET)
    expect(verify(payload, sig, SECRET)).toBe(true)
  })

  it("verify fails for wrong secret", () => {
    const sig = sign("hi", SECRET)
    expect(verify("hi", sig, "different-secret-padding-aaaaaa")).toBe(false)
  })

  it("verify fails for tampered payload", () => {
    const sig = sign("hi", SECRET)
    expect(verify("HI", sig, SECRET)).toBe(false)
  })
})
```

- [ ] **Step 4.5: Run test, expect fail**

```bash
cd /Users/cataholic/.gemini/File/G/apps/workers
npx vitest run __tests__/hmac.test.ts
```

Expected: 3 fail (module not found).

- [ ] **Step 4.6: Implement lib/hmac.ts**

Create `apps/workers/src/lib/hmac.ts`:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto"

export function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex")
}

export function verify(payload: string, signature: string, secret: string): boolean {
  const expected = sign(payload, secret)
  if (expected.length !== signature.length) return false
  try { return timingSafeEqual(Buffer.from(expected), Buffer.from(signature)) }
  catch { return false }
}
```

- [ ] **Step 4.7: Run test, expect pass**

```bash
npx vitest run __tests__/hmac.test.ts
```

Expected: 3 passed.

- [ ] **Step 4.8: Write failing test for audit route**

Create `apps/workers/__tests__/audit-route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import express from "express"
import request from "supertest"
import { sign } from "../src/lib/hmac"

vi.mock("@realreal/control-db", () => ({
  createControlClient: () => ({
    from: () => ({ insert: vi.fn().mockResolvedValue({ error: null }) }),
  }),
  audit: { emitAudit: vi.fn().mockResolvedValue(undefined) },
}))

const SECRET = "internal-api-secret-aaaaaaaaaaaa"
process.env.INTERNAL_API_SECRET = SECRET

let app: express.Express
beforeEach(async () => {
  vi.resetModules()
  app = express()
  app.use(express.json())
  const { auditRouter } = await import("../src/routes/audit")
  app.use("/internal/audit", auditRouter)
})

describe("POST /internal/audit", () => {
  it("returns 401 without signature", async () => {
    const res = await request(app).post("/internal/audit").send({ action: "test" })
    expect(res.status).toBe(401)
  })

  it("returns 401 with bad signature", async () => {
    const body = { tenant_id: null, actor_type: "system", action: "x" }
    const res = await request(app).post("/internal/audit")
      .set("X-Signature", "deadbeef").send(body)
    expect(res.status).toBe(401)
  })

  it("returns 200 with valid signature", async () => {
    const body = { tenant_id: null, actor_type: "system", action: "x" }
    const sig = sign(JSON.stringify(body), SECRET)
    const res = await request(app).post("/internal/audit")
      .set("X-Signature", sig).send(body)
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 4.9: Run, expect fail**

```bash
npx vitest run __tests__/audit-route.test.ts
```

Expected: 3 fail (module not found).

- [ ] **Step 4.10: Implement routes/audit.ts**

Create `apps/workers/src/routes/audit.ts`:

```typescript
import { Router } from "express"
import { audit, createControlClient } from "@realreal/control-db"
import { verify } from "../lib/hmac"

export const auditRouter = Router()

auditRouter.post("/", async (req, res) => {
  const sig = req.headers["x-signature"]
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) { res.status(500).json({ error: "INTERNAL_API_SECRET not set" }); return }
  if (typeof sig !== "string" || !verify(JSON.stringify(req.body), sig, secret)) {
    res.status(401).json({ error: "Invalid signature" }); return
  }

  const { tenant_id, actor_type, actor_id, action, resource, payload } = req.body ?? {}
  if (!actor_type || !action) { res.status(400).json({ error: "actor_type + action required" }); return }

  try {
    await audit.emitAudit(createControlClient(), {
      tenant_id: tenant_id ?? null,
      actor_type, actor_id: actor_id ?? null, action,
      resource: resource ?? null, payload: payload ?? null,
    })
    res.status(200).json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})
```

- [ ] **Step 4.11: Run, expect pass**

```bash
npx vitest run __tests__/audit-route.test.ts
```

Expected: 3 passed.

- [ ] **Step 4.12: Implement webhooks/stripe.ts (skeleton)**

Create `apps/workers/src/webhooks/stripe.ts`:

```typescript
import { Router, raw } from "express"
import Stripe from "stripe"
import { createControlClient } from "@realreal/control-db"

export const stripeWebhookRouter = Router()

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY ?? ""
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? ""

const stripe = STRIPE_SECRET ? new Stripe(STRIPE_SECRET) : null

// IMPORTANT: stripe webhook expects the RAW request body for signature verification.
// Mount this router with `app.use("/webhooks/stripe", raw({ type: "application/json" }), stripeWebhookRouter)`
stripeWebhookRouter.post("/", async (req, res) => {
  if (!stripe || !WEBHOOK_SECRET) {
    res.status(503).json({ error: "Stripe not configured" }); return
  }

  const sig = req.headers["stripe-signature"] as string
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET)
  } catch (err) {
    res.status(400).json({ error: `Signature: ${(err as Error).message}` }); return
  }

  // Idempotency
  const c = createControlClient()
  const { error: insertErr } = await c.from("stripe_webhook_events").insert({
    event_id: event.id, type: event.type, payload: event,
  })
  if (insertErr && insertErr.code === "23505") {
    res.json({ ok: true, deduplicated: true }); return
  }
  if (insertErr) { res.status(500).json({ error: insertErr.message }); return }

  // Phase A: only record. Phase D will dispatch on event.type to enqueue provisioning_jobs.
  console.log(`[stripe] received event ${event.type} ${event.id} (no-op until Phase D)`)
  res.json({ ok: true })
})
```

- [ ] **Step 4.13: Implement jobs/runner.ts (skeleton)**

Create `apps/workers/src/jobs/runner.ts`:

```typescript
import { jobs, createControlClient } from "@realreal/control-db"

let running = false

export async function tick() {
  if (running) return
  running = true
  try {
    const c = createControlClient()
    const job = await jobs.claimQueuedJob(c)
    if (!job) return
    console.log(`[runner] claimed job ${job.id} step=${job.step} (no handlers in Phase A; marking failed)`)
    await jobs.markJobStatus(c, job.id, "failed", { last_error: "No handler — Phase A skeleton" })
  } catch (e) {
    console.error("[runner] tick error:", e)
  } finally {
    running = false
  }
}

export function startRunner(intervalMs = 1_000) {
  setInterval(tick, intervalMs)
  console.log(`[runner] started, tick every ${intervalMs}ms`)
}
```

- [ ] **Step 4.14: Implement cron/health-check.ts (skeleton)**

Create `apps/workers/src/cron/health-check.ts`:

```typescript
import { tenants, health, createControlClient } from "@realreal/control-db"

export async function runHealthCheck() {
  const c = createControlClient()
  const list = await tenants.listActiveTenants(c)
  console.log(`[cron:health] ${list.length} active tenants`)
  for (const t of list) {
    // Phase A skeleton: only ping vercel and api if URLs known. Full impl in Phase E.
    const checks = await Promise.allSettled([
      // placeholder probe — actual URLs come from tenant_infrastructure (Phase C populates)
      Promise.resolve(true),
    ])
    await health.recordHealth(c, {
      tenant_id: t.id,
      vercel_ok: true, api_ok: true, mcp_ok: true, supabase_ok: true,
      details: { phase: "a-skeleton" },
    })
  }
}
```

- [ ] **Step 4.15: Implement cron/resend-dkim-verify.ts (skeleton)**

Create `apps/workers/src/cron/resend-dkim-verify.ts`:

```typescript
export async function runDkimVerify() {
  // Phase D will iterate tenant_infrastructure rows where resend_dkim_verified_at is null
  // and poll Resend's domain status API.
  console.log("[cron:dkim] skeleton — no-op until Phase D")
}
```

- [ ] **Step 4.16: Implement cron/stripe-sync.ts (skeleton)**

Create `apps/workers/src/cron/stripe-sync.ts`:

```typescript
export async function runStripeSync() {
  // Phase D will reconcile billing_subscriptions with Stripe.
  console.log("[cron:stripe-sync] skeleton — no-op until Phase D")
}
```

- [ ] **Step 4.17: Implement src/index.ts**

Create `apps/workers/src/index.ts`:

```typescript
import express, { raw } from "express"
import cron from "node-cron"
import { auditRouter } from "./routes/audit"
import { stripeWebhookRouter } from "./webhooks/stripe"
import { startRunner } from "./jobs/runner"
import { runHealthCheck } from "./cron/health-check"
import { runDkimVerify } from "./cron/resend-dkim-verify"
import { runStripeSync } from "./cron/stripe-sync"

const app = express()

// Stripe webhook needs RAW body
app.use("/webhooks/stripe", raw({ type: "application/json" }), stripeWebhookRouter)

// All other routes use JSON
app.use(express.json({ limit: "1mb" }))

app.get("/health", (_req, res) => res.json({ status: "ok", ts: new Date().toISOString() }))
app.use("/internal/audit", auditRouter)

const PORT = Number(process.env.PORT ?? 4001)
app.listen(PORT, () => console.log(`[workers] listening on ${PORT}`))

// Cron schedule
cron.schedule("*/5 * * * *", runHealthCheck)            // every 5 min
cron.schedule("0 * * * *", runDkimVerify)               // every hour
cron.schedule("0 4 * * *", runStripeSync)               // 04:00 daily

// Job runner tick every second
startRunner(1_000)
```

- [ ] **Step 4.18: Run all workers tests**

```bash
cd /Users/cataholic/.gemini/File/G/apps/workers
npx vitest run
```

Expected: 6 passed (3 hmac + 3 audit-route).

- [ ] **Step 4.19: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.20: Local smoke run**

```bash
INTERNAL_API_SECRET="local-dev-secret-aaaaaaaaaaaaaaaa" \
CONTROL_DB_URL="https://<CONTROL_REF>.supabase.co" \
CONTROL_DB_SERVICE_ROLE_KEY="<service_role_key>" \
npx tsx src/index.ts &

sleep 3
curl -s http://localhost:4001/health
kill %1
```

Expected: `{"status":"ok",...}`. (Cron will log "0 active tenants" on the first 5-min tick, but you can ctrl-C before then.)

- [ ] **Step 4.21: Commit**

```bash
cd /Users/cataholic/.gemini/File/G
git checkout -b plan/phase-a-4-workers-skeleton
git add apps/workers/
git commit -m "feat(workers): skeleton HTTP + cron + audit endpoint

- /health endpoint
- /internal/audit (HMAC-SHA256 verified, INTERNAL_API_SECRET shared with apps/api)
- /webhooks/stripe (signature verify + event_id idempotency only; full handler in Phase D)
- Job runner skeleton: claims queued jobs but immediately marks failed (no handlers)
- Cron tasks (skeletons): health-check (5min), dkim-verify (hourly), stripe-sync (daily)
- node-cron + Stripe SDK, Railway NIXPACKS config

Tests: 3 HMAC, 3 audit route. Per spec §4 + §6 + §9."
git push -u origin plan/phase-a-4-workers-skeleton
gh pr create --base main --title "Phase A-4: workers skeleton" --body "..."
```

---

## Task 5 (PR-A5): apps/control Next.js scaffold + auth

**Goal:** A new Next.js dashboard at `apps/control/` with shadcn/ui scaffolding, login page, and a platform-users-only auth gate. Builds successfully but pages are empty placeholders.

**Files:**
- Create: `apps/control/package.json`
- Create: `apps/control/next.config.ts`
- Create: `apps/control/tsconfig.json`
- Create: `apps/control/postcss.config.mjs`
- Create: `apps/control/eslint.config.mjs`
- Create: `apps/control/components.json`
- Create: `apps/control/src/app/layout.tsx`
- Create: `apps/control/src/app/globals.css`
- Create: `apps/control/src/app/page.tsx`
- Create: `apps/control/src/app/auth/login/page.tsx`
- Create: `apps/control/src/app/auth/callback/route.ts`
- Create: `apps/control/src/lib/auth.ts`
- Create: `apps/control/src/lib/control-db.ts`
- Create: `apps/control/src/middleware.ts`

### Steps

- [ ] **Step 5.1: Scaffold via existing apps/web as template**

```bash
cd /Users/cataholic/.gemini/File/G
cp -r apps/web apps/control
cd apps/control
rm -rf .next .vercel
# Reset to a minimal page set: keep config files, remove all storefront pages
rm -rf src/app/shop src/app/blog src/app/admin src/app/auth/register src/app/checkout \
       src/app/my-account src/app/about src/app/contact src/app/faq src/app/privacy \
       src/app/terms src/app/shipping src/app/returns src/app/search src/app/subscribe
```

- [ ] **Step 5.2: Adjust package.json**

Edit `apps/control/package.json` so its `name` is `control`:

```bash
node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('apps/control/package.json'));
p.name = 'control';
p.dependencies['@realreal/control-db'] = '*';
fs.writeFileSync('apps/control/package.json', JSON.stringify(p, null, 2));
"
```

- [ ] **Step 5.3: Implement lib/control-db.ts**

Create `apps/control/src/lib/control-db.ts`:

```typescript
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

export async function createControlClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_CONTROL_DB_URL!,
    process.env.NEXT_PUBLIC_CONTROL_DB_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cs) { cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) },
      },
    },
  )
}
```

- [ ] **Step 5.4: Implement lib/auth.ts**

Create `apps/control/src/lib/auth.ts`:

```typescript
import { createControlClient } from "./control-db"
import { redirect } from "next/navigation"

/** Returns the current platform_user (Supabase auth user that exists in platform_users), or redirects to login. */
export async function requirePlatformUser() {
  const supabase = await createControlClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const { data: pu, error } = await supabase
    .from("platform_users")
    .select("id, email")
    .eq("email", user.email!)
    .maybeSingle()

  if (error || !pu) redirect("/auth/login?reason=not-platform-user")
  return pu
}
```

- [ ] **Step 5.5: Implement middleware.ts**

Create `apps/control/src/middleware.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server"

export async function middleware(req: NextRequest) {
  // Light-touch middleware: just refresh Supabase session cookies.
  // Per-page auth check happens in requirePlatformUser().
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
```

- [ ] **Step 5.6: Implement auth/login/page.tsx**

Create `apps/control/src/app/auth/login/page.tsx`:

```tsx
"use client"

import { useState } from "react"
import { createBrowserClient } from "@supabase/ssr"

export default function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_CONTROL_DB_URL!,
      process.env.NEXT_PUBLIC_CONTROL_DB_ANON_KEY!,
    )
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Platform Control</h1>
        {sent ? (
          <p className="text-sm text-muted-foreground">Magic link sent. Check {email}.</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input
              type="email" required value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="email@example.com"
              className="w-full border rounded px-3 py-2 text-sm"
            />
            <button type="submit" className="w-full bg-foreground text-background rounded py-2 text-sm">
              Send magic link
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </form>
        )}
      </div>
    </main>
  )
}
```

- [ ] **Step 5.7: Implement auth/callback/route.ts**

Create `apps/control/src/app/auth/callback/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server"
import { createControlClient } from "@/lib/control-db"

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  if (code) {
    const supabase = await createControlClient()
    await supabase.auth.exchangeCodeForSession(code)
  }
  return NextResponse.redirect(new URL("/", req.url))
}
```

- [ ] **Step 5.8: Replace app/page.tsx**

Replace `apps/control/src/app/page.tsx`:

```tsx
import { requirePlatformUser } from "@/lib/auth"

export const metadata = { title: "Platform Control" }

export default async function HomePage() {
  const user = await requirePlatformUser()
  return (
    <main className="p-8 space-y-4">
      <h1 className="text-xl font-semibold">Platform Control</h1>
      <p className="text-sm text-muted-foreground">Signed in as {user.email}</p>
      <p className="text-sm">Phase A scaffold — pages get real content in PR-A6.</p>
    </main>
  )
}
```

- [ ] **Step 5.9: Replace app/layout.tsx**

Edit `apps/control/src/app/layout.tsx` to a minimal version:

```tsx
import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Platform Control",
  description: "Multi-tenant platform control plane",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 5.10: Insert your platform_user row in control DB**

You (the operator) need a `platform_users` row to log in. Run:

```bash
SUPABASE_PAT="sbp_..." curl -s -X POST -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" -H "User-Agent: bootstrap/1.0" \
  -d "{\"query\":\"insert into platform_users (email) values ('armand7951@gmail.com') on conflict (email) do nothing returning id, email\"}" \
  https://api.supabase.com/v1/projects/$CONTROL_REF/database/query
```

Expected: row returned (or empty array if already exists from a previous run).

- [ ] **Step 5.11: Build locally**

```bash
cd /Users/cataholic/.gemini/File/G/apps/control
npm install
NEXT_PUBLIC_CONTROL_DB_URL="https://<CONTROL_REF>.supabase.co" \
NEXT_PUBLIC_CONTROL_DB_ANON_KEY="<anon_key>" \
npm run build
```

Expected: build succeeds.

- [ ] **Step 5.12: Smoke test locally**

```bash
NEXT_PUBLIC_CONTROL_DB_URL="..." NEXT_PUBLIC_CONTROL_DB_ANON_KEY="..." npm run dev &
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/auth/login
kill %1
```

Expected: `200`.

- [ ] **Step 5.13: Commit**

```bash
cd /Users/cataholic/.gemini/File/G
git checkout -b plan/phase-a-5-control-scaffold
git add apps/control/
git commit -m "feat(control): Next.js scaffold with magic-link auth gated to platform_users

Branched from apps/web's config (Tailwind v4, Next 16, React 19).
Removes all storefront pages. Adds:
- /auth/login (Supabase magic link)
- /auth/callback (PKCE code exchange)
- requirePlatformUser() in lib/auth.ts (checks email is in platform_users table)
- empty / placeholder homepage signed-in by armand7951@gmail.com

Pages get real content in PR-A6."
git push -u origin plan/phase-a-5-control-scaffold
gh pr create --base main --title "Phase A-5: control plane Next.js scaffold" --body "..."
```

---

## Task 6 (PR-A6): apps/control pages with live data

**Goal:** Five pages now read from the control DB and render lists/details: `/`, `/tenants`, `/tenants/[id]`, `/jobs`, `/audit`.

**Files:**
- Modify: `apps/control/src/app/page.tsx`
- Create: `apps/control/src/app/tenants/page.tsx`
- Create: `apps/control/src/app/tenants/[id]/page.tsx`
- Create: `apps/control/src/app/jobs/page.tsx`
- Create: `apps/control/src/app/audit/page.tsx`
- Create: `apps/control/src/lib/format.ts`
- Create: `apps/control/src/components/nav.tsx`

### Steps

- [ ] **Step 6.1: Implement lib/format.ts**

Create `apps/control/src/lib/format.ts`:

```typescript
export function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  })
}

export function statusColor(status: string): string {
  return {
    active: "text-green-600",
    provisioning: "text-blue-600",
    pending_payment: "text-yellow-600",
    failed: "text-red-600",
    canceled: "text-gray-500",
    suspended: "text-orange-600",
  }[status] ?? "text-foreground"
}
```

- [ ] **Step 6.2: Implement components/nav.tsx**

Create `apps/control/src/components/nav.tsx`:

```tsx
import Link from "next/link"

export function Nav() {
  return (
    <nav className="border-b px-6 py-3 flex gap-4 text-sm">
      <Link href="/">Overview</Link>
      <Link href="/tenants">Tenants</Link>
      <Link href="/jobs">Jobs</Link>
      <Link href="/audit">Audit</Link>
    </nav>
  )
}
```

- [ ] **Step 6.3: Update layout.tsx to include nav**

Edit `apps/control/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next"
import "./globals.css"
import { Nav } from "@/components/nav"

export const metadata: Metadata = { title: "Platform Control" }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  )
}
```

- [ ] **Step 6.4: Implement / overview page**

Replace `apps/control/src/app/page.tsx`:

```tsx
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"

export const metadata = { title: "Platform Control" }

export default async function HomePage() {
  await requirePlatformUser()
  const supabase = await createControlClient()

  const { count: tenantCount } = await supabase.from("tenants")
    .select("*", { count: "exact", head: true }).eq("status", "active")

  const { count: queuedJobs } = await supabase.from("provisioning_jobs")
    .select("*", { count: "exact", head: true }).eq("status", "queued")

  const { count: failedJobs } = await supabase.from("provisioning_jobs")
    .select("*", { count: "exact", head: true }).eq("status", "failed")

  return (
    <main className="p-8 space-y-6">
      <h1 className="text-xl font-semibold">Overview</h1>
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Active tenants" value={tenantCount ?? 0} />
        <Stat label="Queued jobs" value={queuedJobs ?? 0} />
        <Stat label="Failed jobs" value={failedJobs ?? 0} colorIfNonZero="text-red-600" />
      </div>
    </main>
  )
}

function Stat({ label, value, colorIfNonZero }: { label: string; value: number; colorIfNonZero?: string }) {
  const color = colorIfNonZero && value > 0 ? colorIfNonZero : "text-foreground"
  return (
    <div className="border rounded p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  )
}
```

- [ ] **Step 6.5: Implement /tenants list**

Create `apps/control/src/app/tenants/page.tsx`:

```tsx
import Link from "next/link"
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { fmtDate, statusColor } from "@/lib/format"

export const metadata = { title: "Tenants | Platform Control" }

export default async function TenantsPage() {
  await requirePlatformUser()
  const supabase = await createControlClient()
  const { data, error } = await supabase
    .from("tenants").select("id, slug, custom_domain, status, plan, created_at, activated_at")
    .order("created_at", { ascending: false })

  if (error) return <main className="p-8">Error: {error.message}</main>

  return (
    <main className="p-8 space-y-4">
      <h1 className="text-xl font-semibold">Tenants ({data?.length ?? 0})</h1>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-2">Slug</th><th>Domain</th><th>Status</th>
            <th>Plan</th><th>Activated</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map(t => (
            <tr key={t.id} className="border-t">
              <td className="py-2"><Link href={`/tenants/${t.id}`} className="underline">{t.slug}</Link></td>
              <td>{t.custom_domain ?? "—"}</td>
              <td className={statusColor(t.status)}>{t.status}</td>
              <td>{t.plan ?? "—"}</td>
              <td>{fmtDate(t.activated_at)}</td>
            </tr>
          ))}
          {(data ?? []).length === 0 && (
            <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No tenants yet.</td></tr>
          )}
        </tbody>
      </table>
    </main>
  )
}
```

- [ ] **Step 6.6: Implement /tenants/[id] detail**

Create `apps/control/src/app/tenants/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation"
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { fmtDate, statusColor } from "@/lib/format"

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requirePlatformUser()
  const supabase = await createControlClient()

  const { data: tenant } = await supabase.from("tenants").select("*").eq("id", id).maybeSingle()
  if (!tenant) notFound()

  const { data: infra } = await supabase.from("tenant_infrastructure")
    .select("vercel_deployment_url, railway_api_url, railway_mcp_url, supabase_project_ref, resend_dkim_verified_at")
    .eq("tenant_id", id).maybeSingle()

  const { data: modules } = await supabase.from("tenant_modules")
    .select("module, enabled, enabled_at").eq("tenant_id", id).order("module")

  const { data: recentJobs } = await supabase.from("provisioning_jobs")
    .select("step, status, attempt, last_error, created_at, finished_at")
    .eq("tenant_id", id).order("created_at", { ascending: false }).limit(10)

  const { data: recentHealth } = await supabase.from("tenant_health_log")
    .select("checked_at, vercel_ok, api_ok, mcp_ok, supabase_ok")
    .eq("tenant_id", id).order("checked_at", { ascending: false }).limit(20)

  return (
    <main className="p-8 space-y-6">
      <h1 className="text-xl font-semibold">{tenant.slug}</h1>
      <p className={`text-sm ${statusColor(tenant.status)}`}>{tenant.status}</p>

      <section>
        <h2 className="font-semibold mb-2">Infrastructure</h2>
        {infra ? (
          <ul className="text-sm space-y-1">
            <li>Vercel: {infra.vercel_deployment_url ?? "—"}</li>
            <li>Railway api: {infra.railway_api_url ?? "—"}</li>
            <li>Railway mcp: {infra.railway_mcp_url ?? "—"}</li>
            <li>Supabase ref: {infra.supabase_project_ref}</li>
            <li>Resend DKIM verified: {fmtDate(infra.resend_dkim_verified_at)}</li>
          </ul>
        ) : <p className="text-sm text-muted-foreground">No infrastructure record.</p>}
      </section>

      <section>
        <h2 className="font-semibold mb-2">Modules</h2>
        <ul className="text-sm grid grid-cols-2 gap-1">
          {(modules ?? []).map(m => (
            <li key={m.module}>{m.enabled ? "✓" : "○"} {m.module}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Recent provisioning jobs</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr><th className="py-1">Step</th><th>Status</th><th>Attempt</th><th>Created</th></tr>
          </thead>
          <tbody>
            {(recentJobs ?? []).map((j, i) => (
              <tr key={i} className="border-t">
                <td className="py-1">{j.step}</td>
                <td className={statusColor(j.status)}>{j.status}</td>
                <td>{j.attempt}</td>
                <td>{fmtDate(j.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Recent health (last 20)</h2>
        <ul className="text-xs flex flex-wrap gap-1">
          {(recentHealth ?? []).map((h, i) => {
            const ok = h.vercel_ok && h.api_ok && h.mcp_ok && h.supabase_ok
            return (
              <li key={i} title={fmtDate(h.checked_at)}
                  className={`w-3 h-3 rounded-sm ${ok ? "bg-green-500" : "bg-red-500"}`} />
            )
          })}
        </ul>
      </section>
    </main>
  )
}
```

- [ ] **Step 6.7: Implement /jobs page**

Create `apps/control/src/app/jobs/page.tsx`:

```tsx
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { fmtDate, statusColor } from "@/lib/format"

export const metadata = { title: "Jobs | Platform Control" }

export default async function JobsPage() {
  await requirePlatformUser()
  const supabase = await createControlClient()
  const { data } = await supabase.from("provisioning_jobs")
    .select("id, tenant_id, step, status, attempt, last_error, created_at")
    .order("created_at", { ascending: false }).limit(200)

  return (
    <main className="p-8 space-y-4">
      <h1 className="text-xl font-semibold">Provisioning jobs</h1>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr><th className="py-2">Created</th><th>Tenant</th><th>Step</th><th>Status</th><th>Attempt</th><th>Error</th></tr>
        </thead>
        <tbody>
          {(data ?? []).map(j => (
            <tr key={j.id} className="border-t align-top">
              <td className="py-2">{fmtDate(j.created_at)}</td>
              <td className="font-mono text-xs">{j.tenant_id?.slice(0, 8)}</td>
              <td>{j.step}</td>
              <td className={statusColor(j.status)}>{j.status}</td>
              <td>{j.attempt}</td>
              <td className="max-w-xs truncate text-red-600">{j.last_error ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
```

- [ ] **Step 6.8: Implement /audit page**

Create `apps/control/src/app/audit/page.tsx`:

```tsx
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { fmtDate } from "@/lib/format"

export const metadata = { title: "Audit | Platform Control" }

export default async function AuditPage() {
  await requirePlatformUser()
  const supabase = await createControlClient()
  const { data } = await supabase.from("audit_log")
    .select("created_at, tenant_id, actor_type, actor_id, action, resource")
    .order("created_at", { ascending: false }).limit(500)

  return (
    <main className="p-8 space-y-4">
      <h1 className="text-xl font-semibold">Audit log</h1>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr><th className="py-2">Time</th><th>Actor</th><th>Tenant</th><th>Action</th><th>Resource</th></tr>
        </thead>
        <tbody>
          {(data ?? []).map((e, i) => (
            <tr key={i} className="border-t">
              <td className="py-2">{fmtDate(e.created_at)}</td>
              <td className="text-xs">{e.actor_type}{e.actor_id ? `:${e.actor_id}` : ""}</td>
              <td className="font-mono text-xs">{e.tenant_id?.slice(0, 8) ?? "—"}</td>
              <td>{e.action}</td>
              <td className="text-xs">{e.resource ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
```

- [ ] **Step 6.9: Build + smoke test**

```bash
cd /Users/cataholic/.gemini/File/G/apps/control
NEXT_PUBLIC_CONTROL_DB_URL="https://$CONTROL_REF.supabase.co" \
NEXT_PUBLIC_CONTROL_DB_ANON_KEY="<anon>" \
npm run build
```

Expected: 5 routes built (`/`, `/tenants`, `/tenants/[id]`, `/jobs`, `/audit`).

- [ ] **Step 6.10: Commit**

```bash
cd /Users/cataholic/.gemini/File/G
git checkout -b plan/phase-a-6-control-pages
git add apps/control/src/app/ apps/control/src/lib/format.ts apps/control/src/components/nav.tsx
git commit -m "feat(control): live dashboard pages

- Overview / with active-tenant / queued / failed counts
- /tenants list (status-colored)
- /tenants/[id] detail (infra, modules, jobs, health timeline)
- /jobs queue
- /audit log

All pages requirePlatformUser(). Empty until tenants are registered
(Phase C). Per spec §4."
git push -u origin plan/phase-a-6-control-pages
gh pr create --base main --title "Phase A-6: control plane pages" --body "..."
```

---

## Task 7 (PR-A7): Deploy control plane to Vercel + Railway

**Goal:** `apps/control` is live at `platform.realreal.cc` (Vercel), `apps/workers` is live on Railway, both healthy and reachable.

**Files (no source changes; only deploy operations + minor config):**
- Modify: root `package.json` (turbo task additions if needed)
- Use existing CLI tools: `vercel`, `railway`, Cloudflare API

### Steps

- [ ] **Step 7.1: Generate platform-level secrets**

```bash
PLATFORM_KEK=$(openssl rand -hex 32)
INTERNAL_API_SECRET=$(openssl rand -hex 32)
echo "PLATFORM_KEK=$PLATFORM_KEK" > /tmp/platform-secrets.txt
echo "INTERNAL_API_SECRET=$INTERNAL_API_SECRET" >> /tmp/platform-secrets.txt
chmod 600 /tmp/platform-secrets.txt
```

- [ ] **Step 7.2: Deploy apps/workers to Railway**

```bash
cd /Users/cataholic/.gemini/File/G/apps/workers
railway init --name platform-workers --json
railway add --service workers \
  --variables "NODE_ENV=production" \
  --variables "NIXPACKS_NODE_VERSION=22" \
  --variables "CONTROL_DB_URL=https://$CONTROL_REF.supabase.co" \
  --variables "CONTROL_DB_SERVICE_ROLE_KEY=<service_role_from_/tmp/control-keys.txt>" \
  --variables "PLATFORM_KEK=$PLATFORM_KEK" \
  --variables "INTERNAL_API_SECRET=$INTERNAL_API_SECRET"
railway link
railway up --ci --detach
railway domain
```

Expected: Railway returns a `*.up.railway.app` domain. Save it as `PLATFORM_WORKERS_URL`.

- [ ] **Step 7.3: Wait for workers healthy**

```bash
until [ "$(curl -s -o /dev/null -w '%{http_code}' $PLATFORM_WORKERS_URL/health)" = "200" ]; do sleep 15; echo "..."; done
echo "workers healthy"
```

- [ ] **Step 7.4: Create Vercel project for apps/control**

```bash
cd /Users/cataholic/.gemini/File/G/apps/control
vercel link --yes --project platform-control
echo "https://$CONTROL_REF.supabase.co" | vercel env add NEXT_PUBLIC_CONTROL_DB_URL production
echo "<anon_key>" | vercel env add NEXT_PUBLIC_CONTROL_DB_ANON_KEY production
echo "$PLATFORM_WORKERS_URL" | vercel env add PLATFORM_WORKERS_URL production
vercel --prod --yes
```

Expected: Vercel returns the production URL (e.g., `platform-control-xxx.vercel.app`).

- [ ] **Step 7.5: DNS — add platform.realreal.cc CNAME in Cloudflare**

In your Cloudflare dashboard for the `realreal.cc` zone, add:

```
Type:   CNAME
Name:   platform
Target: cname.vercel-dns.com
Proxy:  DNS only (grey cloud)
TTL:    Auto
```

Wait 1–5 minutes for propagation.

- [ ] **Step 7.6: Add custom domain to Vercel**

```bash
cd /Users/cataholic/.gemini/File/G/apps/control
vercel domains add platform.realreal.cc
```

Expected: Vercel verifies the CNAME, requests SSL, completes within ~30s.

- [ ] **Step 7.7: Smoke test live**

```bash
curl -s -o /dev/null -w "%{http_code} platform.realreal.cc/auth/login\n" https://platform.realreal.cc/auth/login
curl -s -o /dev/null -w "%{http_code} workers/health\n" $PLATFORM_WORKERS_URL/health
curl -s $PLATFORM_WORKERS_URL/health
```

Expected:
```
200 platform.realreal.cc/auth/login
200 workers/health
{"status":"ok","ts":"2026-..."}
```

- [ ] **Step 7.8: Test the full magic-link login flow**

1. Open `https://platform.realreal.cc/auth/login` in your browser.
2. Enter `armand7951@gmail.com`.
3. Receive magic link in Gmail (sent via Supabase Auth's default, not Resend — that's a tenant concern).
4. Click link → redirects to `https://platform.realreal.cc/`.
5. See "Signed in as armand7951@gmail.com" + the 3 stat cards (all 0).

If any step fails, **STOP**. Likely causes:
- Supabase Auth Site URL not set → set to `https://platform.realreal.cc` in `platform-control` Supabase Authentication settings.
- Magic link redirects to wrong URL → set Auth `Redirect URLs` allow-list to `https://platform.realreal.cc/auth/callback`.

- [ ] **Step 7.9: Test the audit endpoint end-to-end**

```bash
BODY='{"tenant_id":null,"actor_type":"system","action":"phase-a-deploy.smoke","payload":{"test":true}}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$INTERNAL_API_SECRET" | awk '{print $2}')
curl -s -X POST -H "Content-Type: application/json" -H "X-Signature: $SIG" \
  -d "$BODY" $PLATFORM_WORKERS_URL/internal/audit
```

Expected: `{"ok":true}`.

Verify in DB:

```bash
SUPABASE_PAT="sbp_..." curl -s -X POST -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" -H "User-Agent: verify/1.0" \
  -d "{\"query\":\"select action, payload from audit_log where action='phase-a-deploy.smoke'\"}" \
  https://api.supabase.com/v1/projects/$CONTROL_REF/database/query
```

Expected: 1 row with `action: phase-a-deploy.smoke`. Open the dashboard's `/audit` page in browser — that row should appear.

- [ ] **Step 7.10: Commit (operational notes only)**

There may be no source changes in this PR (only Vercel/Railway/DNS state). If you want a paper trail, create a no-op commit with the URLs and PR notes:

```bash
cd /Users/cataholic/.gemini/File/G
git checkout -b plan/phase-a-7-deploy
cat > docs/runbooks/platform-deployment.md << 'EOF'
# Platform Control Plane Deployment

- Dashboard: https://platform.realreal.cc → Vercel project `platform-control`
- Workers:   https://<id>.up.railway.app → Railway project `platform-workers`
- Control DB: Supabase project ref `<CONTROL_REF>` (see /tmp/control-project.json)

## Required env vars (Railway: workers)
- CONTROL_DB_URL
- CONTROL_DB_SERVICE_ROLE_KEY
- PLATFORM_KEK (32 hex bytes)
- INTERNAL_API_SECRET
- NIXPACKS_NODE_VERSION=22

## Required env vars (Vercel: control)
- NEXT_PUBLIC_CONTROL_DB_URL
- NEXT_PUBLIC_CONTROL_DB_ANON_KEY
- PLATFORM_WORKERS_URL

## Smoke tests
- GET /health (workers) → 200
- GET /auth/login (dashboard) → 200
- Magic link login → see overview page with 3 stat cards
- POST /internal/audit (HMAC-signed) → see entry in /audit

## Recovery
Re-run `infrastructure/provisioning/apply-control-migrations.ts` to re-create schema if the project is re-provisioned. Keep PLATFORM_KEK safe (encrypted column data is unrecoverable without it).
EOF
git add docs/runbooks/platform-deployment.md
git commit -m "docs(runbook): platform control plane deployment

Captures URLs, env vars, smoke tests, recovery for the platform.realreal.cc
dashboard and platform-workers Railway service deployed in PR-A7."
git push -u origin plan/phase-a-7-deploy
gh pr create --base main --title "Phase A-7: deploy control plane runbook" --body "..."
```

---

## Phase A acceptance criteria

Before marking Phase A done and moving to Phase B, verify all of these:

- [ ] `https://platform.realreal.cc/auth/login` returns 200 and shows the magic-link form.
- [ ] Magic link to `armand7951@gmail.com` works → arrive at `/` showing 3 stat cards (active=0, queued=0, failed=0).
- [ ] `/tenants` shows "No tenants yet."
- [ ] `/jobs` shows an empty table.
- [ ] `/audit` shows the smoke-test entry from Step 7.9.
- [ ] `https://<workers>.up.railway.app/health` returns 200.
- [ ] HMAC-signed POST to `/internal/audit` writes to `audit_log`.
- [ ] Control DB has 9 tables + 1 PG function (`claim_queued_job`).
- [ ] Realreal Supabase has migrations 0015–0020 applied; `schema_migrations` table contains 21 rows.
- [ ] Realreal site (`https://agent-web-xi.vercel.app`) and API (`/health`, `/products`) still return 200 — no regression from the new migrations.

---

## Self-Review (post-write)

**1. Spec coverage — every Phase A item in §11:**

- A1 create platform-control Supabase → Task 1 (Steps 1.1–1.2)
- A2 scaffold apps/control → Task 5
- A3 scaffold apps/workers → Task 4
- A4 deploy → Task 7
- A5 control DB schema + schema_migrations bootstrap → Task 1 (control DB) + Task 3 (tenant `schema_migrations`)
- A6 packages/db/migrations/0015..0020 → Task 3
- A7 apply 0015..0020 to realreal first → Task 3 (Step 3.10)

All A1–A7 covered. ✓

**2. Placeholder scan**

Searched for "TBD", "TODO", "implement later", "fill in details", "add appropriate", "similar to Task". The PR notes in `gh pr create --body "..."` are the only placeholders — those are deliberately short PR descriptions the executor fills in (or leaves as a brief note like "see commit message"). Acceptable; flagged.

**3. Type consistency**

- `ProvisioningStep` defined in `packages/control-db/src/types.ts` (Task 2 Step 2.8) is used by `enqueueJobs` (Task 2 Step 2.11) and `apps/workers/src/jobs/runner.ts` (Task 4 Step 4.13). Matches.
- `Tenant` shape returned by `listActiveTenants` (Task 2) is iterated in `apps/control/src/app/tenants/page.tsx` (Task 6 Step 6.5) — fields used (`id, slug, custom_domain, status, plan, created_at, activated_at`) all exist on the type. ✓
- `audit.emitAudit(c, AuditEntry)` signature — Task 2 Step 2.15 defines `(c, e)`. Task 4 Step 4.10 calls it with the same shape. ✓
- `claimQueuedJob` (Task 2.11) returns `ProvisioningJob | null`. Task 4.13 checks for null before proceeding. ✓

**4. Ambiguity check**

- "PR-A7" has minimal source changes; clarified as runbook-only commit. Fine.
- Bootstrap of `platform_users` happens in Step 5.10 — explicit SQL is provided.
- `NEXT_PUBLIC_CONTROL_DB_URL` vs `CONTROL_DB_URL` — the former is for Next.js (browser-readable), the latter is server-only. Both used distinctly. ✓

No issues found that need inline fixes.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-10-phase-a-control-plane.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task (7 tasks total = 7 PRs), review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints for review.

**Which approach?**
