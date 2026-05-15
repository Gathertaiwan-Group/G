# Runbook: PLATFORM_KEK rotation

> Spec §4: `tenant_infrastructure.supabase_service_role_key_encrypted` is
> aes-256-gcm with `PLATFORM_KEK` (a 32-byte key, hex-encoded in env, no KMS
> in v1 — see `packages/control-db/src/crypto.ts`: `encrypt`/`decrypt` take a
> 32-byte Buffer, `parseKek()` reads `PLATFORM_KEK` and requires 64 hex
> chars). §12 Q4: proposed cadence 12 months; revisit after the first audit.
> Cross-linked from `mcp-token-leak.md` (run this if the KEK or a
> service-role key may be exposed).

## When to run

- **Scheduled:** every 12 months (spec §12 Q4 default).
- **Unscheduled:** suspected exposure of `PLATFORM_KEK` or any tenant
  service-role key (security incident — run immediately).

## Known issue (read before rotating)

`PLATFORM_KEK` is currently overloaded: besides encrypting service-role keys,
`apps/workers/src/provisioning/steps/supabase-setup.ts` derives each tenant's
Supabase DB password from `requireEnv("PLATFORM_KEK").slice(0, 24)` — so every
tenant DB shares one KEK-derived password. This is a tracked hardening item
(see `stripe-webhook-pileup.md` §E "Known issues / follow-ups"). Rotating
`PLATFORM_KEK` re-encrypts stored service-role keys but does **not**
re-key those derived DB passwords; resolve that hardening item before relying
on KEK rotation as a credential-exposure remediation for the DB password path.

## Procedure (USER-ACTIONABLE — operator only)

This touches the live encryption key for every tenant's service-role key. It
is operated by the platform admin, never an agent.

1. **Generate the new key:** `openssl rand -hex 32` → `NEW_PLATFORM_KEK`.
2. **Re-encrypt every tenant's stored key.** Run the re-encryption with BOTH
   keys available (decrypt with old, encrypt with new):
   ```bash
   OLD_PLATFORM_KEK=<current> NEW_PLATFORM_KEK=<new> \
   CONTROL_DB_URL=… CONTROL_DB_SERVICE_ROLE_KEY=… \
     npx tsx scripts/rotate-kek.ts        # iterates tenant_infrastructure,
                                          # decrypt(old) -> encrypt(new) -> update
   ```
   > `scripts/rotate-kek.ts` does **not** yet exist. It is a small loop over
   > `tenant_infrastructure` reusing `@realreal/control-db`'s
   > `decrypt(blob, OLD)` then `encrypt(plain, NEW)` (both in
   > `packages/control-db/src/crypto.ts`), then updating
   > `supabase_service_role_key_encrypted`. Ship it as a follow-up before the
   > first scheduled rotation. It is NOT required for GA (no key is being
   > rotated at GA) — documented here so the procedure exists.
3. **Swap the env:** set `PLATFORM_KEK=<new>` on the `platform-workers`
   Railway service AND the `platform-control` Vercel project; redeploy both.
   (Both decrypt service-role keys at runtime — workers in provisioning /
   health, control in admin actions — so both must move together.)
4. **Verify:** trigger a health-check pass and confirm a control action that
   decrypts a service-role key (e.g. a provisioning retry from `/jobs`)
   succeeds without a tag-mismatch error from `decrypt()`.
5. **Destroy the old key material** from local shells / password manager once
   verified.

## On suspected service-role key exposure

Additionally rotate the affected tenant's Supabase service-role key in the
Supabase dashboard, then re-store it (KEK-encrypted) via the control plane.

## Escalate

Any decrypt failure after the env swap → the env swap was applied before
re-encryption completed: revert `PLATFORM_KEK` to the old value, redeploy,
re-run step 2 to completion, then retry the swap.
