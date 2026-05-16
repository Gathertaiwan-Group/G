# Platform Endpoints & Infrastructure Reference

Single source of truth for every deployed URL and infra console in the
multi-tenant platform. Temporary `*.vercel.app` / `*.up.railway.app` hosts are
in use until the realreal.cc DNS cutover (Phase E4); see
`docs/ga-go-live-checklist.md`.

## Live services

| Service | URL | Notes |
|---|---|---|
| realreal storefront (tenant #1, in production) | https://agent-web-xi.vercel.app | Customer storefront (Next.js, Vercel CLI deploy) |
| realreal API | https://api-production-ed3c.up.railway.app | Express API (Railway, CLI deploy) |
| MCP server (tenant agent interface) | https://mcp-production-4099.up.railway.app | `/health` public; `/mcp` requires bearer token; 7 tools |
| Control-plane dashboard | https://control-nu-seven.vercel.app | Phase E admin UI: KPIs, tenant search, provisioning retry, suspend/resume, billing, audit, MCP token rotation. Returns 307 → auth (platform-admin only) |
| Platform workers | https://platform-workers-production-4770.up.railway.app | `/health`; provisioning pipeline, crons, deploy monitor + auto-rollback |
| GA landing / order page | https://agent-web-xi.vercel.app/buy | Phase E7. Stripe **test mode** until live keys are added |

## MCP

- Endpoint: `POST https://mcp-production-4099.up.railway.app/mcp` (Streamable HTTP, stateless)
- Auth: `Authorization: Bearer <token>`; server stores only `sha256(token)` in `tenant_infrastructure.mcp_token_hash`
- Tools (7): `get_brand`, `update_brand`, `list_modules`, `set_module_enabled`, `update_homepage_copy`, `list_orders` (read-only), `list_products` (read-only)
- Token issuance: provisioning (`tenant_finalize`) or rotation via the control dashboard `tenants/[id]/token`
- Leak response: `docs/runbooks/mcp-token-leak.md`

## Infrastructure consoles

| Item | URL |
|---|---|
| GitHub repo | https://github.com/Gathertaiwan-Group/G |
| Control-plane Supabase (tenants / tenant_infrastructure / tenant_health_log) | https://supabase.com/dashboard/project/yqedxfaxbgnlkcrzgmik |
| realreal tenant Supabase (storefront data / Auth) | https://supabase.com/dashboard/project/ozwftlkgqmewtadypsfi |
| Railway project (platform-workers + mcp services) | https://railway.com/project/dd3f7d9f-1052-4cb5-8c6a-6fa25281134a |
| Vercel team (control, agent-web projects) | https://vercel.com/armands-projects-f3e1a37d |

## Pending (active only after Phase E4/E5 — user-actionable)

| Item | Target | Status |
|---|---|---|
| Production domain | https://realreal.cc / https://www.realreal.cc | Awaiting E4 DNS cutover (Cloudflare) |
| Platform subdomain | https://platform.realreal.cc | Awaiting DNS (Supabase Auth allow-list pre-added) |
| Production API domain | https://api.realreal.cc | Awaiting DNS |

## Deploy mechanics (not git-connected)

`agent-web`, `control`, the realreal Railway `api`, `platform-workers`, and `mcp`
are all **CLI-deployed** (`vercel --prod` / `railway up`), not GitHub
git-integration deploys. The Phase D production fan-out
(`scripts/fanout-deploy.ts`) redeploys tenant services via the Vercel/Railway
**management APIs by project/service ID**, not via a git production branch.
