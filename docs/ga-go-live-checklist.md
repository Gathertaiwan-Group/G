# GA go-live checklist (E4 + E5) — USER-ACTIONABLE

> **Every step in this document is performed by the human operator.** No agent
> executes DNS changes, Stripe live-mode activation, live key creation, or
> onboarding a paying customer. This checklist is the agent's *deliverable*;
> the actions are the operator's.

## Pre-flight (agent-automatable parts are already merged)
- [ ] Phase E1 dashboard polish merged & deployed to `platform.realreal.cc`.
- [ ] Six runbooks present in `docs/runbooks/` (validation: see
      `2026-05-10` spec §11). Confirm: `ls docs/runbooks/`.
- [ ] `deploy-production-fanout` `monitor` job merged (PR-E4); secret
      `SLACK_WEBHOOK_URL` set (spec §12 Q1).
- [ ] Welcome email + `docs/mcp-usage.md` merged (PR-E6).
- [ ] Landing page deployed with `NEXT_PUBLIC_STRIPE_CHECKOUT_URL` pointing at
      a **TEST-mode** Stripe payment link; end-to-end test-mode provisioning of
      a throwaway tenant passes (Phase D L3 / `stripe-webhook-pileup.md` §B).

## E4 — realreal.cc DNS cutover  (USER-ACTIONABLE)
> Per the existing 2026-05-17 plan; spec §11 says this is "unaffected" and
> independent — the infra it cuts over to is the same infra we fold in as
> tenant #1, only the registry/identity changes, not the runtime.
- [ ] **(USER)** On the cutover date, update `realreal.cc` DNS at the registrar
      / Cloudflare to point at the tenant-#1 Vercel + Railway exactly as the
      2026-05-17 plan specifies. Do **not** let any agent edit production DNS.
- [ ] **(USER)** Verify `https://realreal.cc` → 200 with pre-migration parity
      (front-end visual + functional), and the control dashboard shows
      tenant #1 = `realreal`, `status=active`.
- [ ] **(USER)** Confirm `tenant_health_log` shows 24h continuous green for
      realreal before proceeding to E5.

## E5 — Stripe live mode + landing open + first paying tenant  (USER-ACTIONABLE)
- [ ] **(USER)** In the Stripe dashboard, complete account activation for
      **live** mode (business/bank details). Create the live product + price
      (spec §12 Q2) mirroring the test-mode one.
- [ ] **(USER)** Create the **live** webhook endpoint → workers
      `/webhooks/stripe`; put the **live** `STRIPE_SECRET_KEY` +
      `STRIPE_WEBHOOK_SECRET` into the `platform-workers` Railway env. Live
      keys never enter the repo, env example files, or any agent context.
- [ ] **(USER)** Create the **live** Stripe Checkout/payment link; set
      `NEXT_PUBLIC_STRIPE_CHECKOUT_URL` on the landing-page Vercel project to
      the live link; redeploy. The landing page is now "open".
- [ ] **(USER)** Onboard the first paying tenant: a real customer (or the
      "one internal test tenant in live mode, stable for 7 days" per spec §11
      validation) completes live Checkout → automated provisioning runs → site
      live in 5–8 min → welcome email received → MCP connects.
- [ ] **(USER)** Watch `/jobs` and `tenant_health_log` for the first live
      provision; have `tenant-down.md` / `stripe-webhook-pileup.md` open.

## GA "done" (spec §11 validation criteria)
- [ ] `https://realreal.cc` 200, parity. (E4)
- [ ] `https://platform.realreal.cc` 200, dashboard shows tenant #1. (E1)
- [ ] Control DB `tenants` shows `realreal` `status=active`.
- [ ] `tenant_health_log` 24h continuous green for realreal. (E4)
- [ ] Claude Code → MCP `update_brand --primary_color=#ff0000` → page red →
      revert. (uses PR-E6 docs + existing MCP)
- [ ] Stripe **test**-mode end-to-end provision of a throwaway tenant passes
      in 5–8 min + smoke (Phase D harness; pre-flight above).
- [ ] One internal test tenant live in **Stripe live mode**, stable 7 days. (E5)
- [ ] **Six runbooks present in `docs/runbooks/`.** (PR-E5)

## Roll-back of GA itself
If the first live provision fails irrecoverably: set
`NEXT_PUBLIC_STRIPE_CHECKOUT_URL` back to the test link (closes intake),
diagnose via `/jobs` + the runbooks, fix, re-open. realreal (tenant #1) is
unaffected by intake state.
