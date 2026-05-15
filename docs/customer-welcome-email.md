# Customer welcome email (copy of record)

> Spec E3. The rendered source of truth is `renderWelcomeEmail()` in
> `apps/workers/src/provisioning/notify.ts` (unit-tested in
> `apps/workers/__tests__/notify-welcome.test.ts`). This doc is the
> human-reviewed copy + rationale; change both together.

## When it is sent

Provisioning step 8 `tenant_finalize` (spec §6), exactly once, after the
tenant is `active`. `From:` is `<Brand Name> <noreply@mail.platform.realreal.cc>`
(platform-subdomain shared sender; BYO-domain tenants use their own DKIM —
spec §6 step 3). It is sent to `OWNER_ADMIN_EMAIL`.

## Contents (must include)

- Storefront URL + `/admin` login URL.
- MCP endpoint URL.
- The MCP bearer token — **shown once**, never re-derivable. The platform
  stores only a one-way hash of the token (`tenant_infrastructure.mcp_token_hash`),
  never the token itself; spec §8. If lost, the platform admin rotates it
  (see `docs/runbooks/mcp-token-leak.md`) and a fresh token is re-issued —
  the old one stops working immediately.
- A link to the MCP usage guide (`docs/mcp-usage.md`).

## Subject & From

- Subject: `<Brand Name> is live 🎉`.
- From display name: `<Brand Name>` (drives both the subject and the
  `From:` header).

## v1 limitations (spec §12 Q5)

- Brand name in v1 = the tenant slug. The provisioning call site
  (`apps/workers/src/provisioning/steps/tenant-finalize.ts`) passes
  `brandName: ctx.tenant.slug`. v1.5 will read `site_contents.brand.name`.
  Documented here so the discrepancy is intended, not a bug.
- Plain transactional copy; a richer onboarding sequence is v1.5.

## Token-secrecy discipline

`renderWelcomeEmail()` is a pure function: it performs no logging and no
network I/O, so the plaintext token cannot leak into a worker log line. A
unit test asserts the renderer never writes the token to any console
channel. `sendWelcomeEmail()` puts the token only in the Resend request
body (never in a log message or thrown error). The provisioning step that
generates the token persists only its hash and never logs the plaintext.
