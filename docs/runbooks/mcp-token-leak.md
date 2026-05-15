# Runbook: MCP token leak

> Spec §8: one long-lived bearer token per tenant. Only the token's
> **sha256 hash** is stored, in `tenant_infrastructure.mcp_token_hash`.
> Rotation is platform-admin via the control dashboard (customer
> self-service rotation is §13 out of scope).
>
> Implementation note (true to merged code): `apps/mcp/src/lib/auth.ts`
> authenticates by `sha256hex(bearer) == tenant_infrastructure.mcp_token_hash`
> (`resolveTenant()`), not bcrypt. The rotation action mints a fresh 32-byte
> token via `infrastructure.hashMcpToken()` and persists only the new sha256
> hash, so the old token's differing hash stops matching the instant the row
> is overwritten.

## Symptom

A tenant's MCP bearer token is exposed (committed to a repo, pasted in a
ticket, found in logs), or `audit_log` shows `customer_agent` actions from an
unexpected source / abnormal rate.

## Diagnose

1. Confirm which tenant the token is for (the customer reports their slug; or
   match the exposed token's usage pattern in `audit_log` —
   `actor_type='customer_agent'` rows are that tenant's MCP tool calls):
   ```sql
   select created_at, actor_id, action, resource from audit_log
   where tenant_id = '<id>' and actor_type = 'customer_agent'
   order by created_at desc limit 100;
   ```
2. Assess blast radius: the MCP token only grants that tenant's admin-level
   tool catalog (spec boundary rule: agent privileges ≤ tenant admin, never
   platform). It cannot touch other tenants or the control plane. The token
   resolves through `resolveTenant()` to that single tenant's Supabase client
   only.

## Resolve

1. **Rotate immediately:** control dashboard → `/tenants/<id>` →
   "Rotate MCP token" (the `rotateMcpToken` server action in
   `apps/control/src/app/tenants/[id]/token/actions.ts`). It is guarded by
   `requirePlatformUser()`, mints a new 32-byte token, stores only its new
   sha256 hash via `infrastructure.setMcpTokenHash`, emits
   `mcp_token.rotated` to `audit_log` (no plaintext/hash in the payload), and
   returns the new plaintext **once** for one-time display. The old token
   stops authenticating on the MCP server's next auth lookup (the new hash no
   longer matches `sha256hex(old_token)`).
2. Securely deliver the new token to the customer (same channel as the welcome
   email; never email it in plaintext to a shared inbox if avoidable).
3. **If the tenant Supabase service-role key may also be exposed** (e.g. the
   leak was a full env dump, not just the MCP token) → the service-role key is
   stored aes-256-gcm-encrypted under `PLATFORM_KEK` in
   `tenant_infrastructure.supabase_service_role_key_encrypted`, but the live
   decrypted value is sensitive: follow **`kek-rotation.md`** to rotate
   `PLATFORM_KEK` and re-encrypt, and rotate the tenant Supabase service-role
   key in the Supabase dashboard.
4. Review `audit_log` for any actions taken with the leaked token; reverse
   destructive ones via `accidental-data-delete.md` if needed.

## Escalate

Evidence the leak reached the service-role key or the control plane → ALERT +
page; treat as a security incident, run `kek-rotation.md`, and notify the
customer.

## USER-ACTIONABLE

Rotating the Supabase service-role key (Supabase dashboard) and KEK rotation
are human-operator actions; the agent only ships the rotation control. Token
rotation itself is operated by the platform admin via the dashboard.
