import pino from "pino"
const log = pino({ name: "notify" })

export interface WelcomeEmailInput {
  brandName: string; slug: string; siteUrl: string; mcpUrl: string; mcpToken: string
}

/**
 * Pure renderer for the branded welcome email (spec E3 / §6 step 3).
 *
 * Returns subject + text + HTML bodies. It is deliberately side-effect-free
 * (no logging, no network): the MCP token is shown to the customer exactly
 * once here and must never reach a log line. The copy of record + rationale
 * lives in docs/customer-welcome-email.md — change both together.
 */
export function renderWelcomeEmail(p: WelcomeEmailInput): {
  subject: string; text: string; html: string
} {
  const subject = `${p.brandName} is live 🎉`
  const text = [
    `Hi — your site "${p.brandName}" is now live.`,
    ``,
    `Storefront:   ${p.siteUrl}`,
    `Admin login:  ${p.siteUrl}/admin`,
    ``,
    `Connect your AI agent (Claude / Cursor) to manage the site:`,
    `  MCP endpoint: ${p.mcpUrl}`,
    `  MCP token (store securely — shown once): ${p.mcpToken}`,
    ``,
    `How to connect + what your agent can do:`,
    `  https://platform.realreal.cc/docs/mcp-usage  (or repo docs/mcp-usage.md)`,
    ``,
    `Need help? Reply to this email.`,
  ].join("\n")
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px">
  <h2>${esc(p.brandName)} is live 🎉</h2>
  <p>Your site is now live.</p>
  <ul>
    <li>Storefront: <a href="${p.siteUrl}">${esc(p.siteUrl)}</a></li>
    <li>Admin login: <a href="${p.siteUrl}/admin">${esc(p.siteUrl)}/admin</a></li>
  </ul>
  <p><strong>Connect your AI agent (Claude / Cursor):</strong></p>
  <ul>
    <li>MCP endpoint: <code>${esc(p.mcpUrl)}</code></li>
    <li>MCP token (store securely — <strong>shown once</strong>):
        <code>${esc(p.mcpToken)}</code></li>
  </ul>
  <p>Setup guide &amp; tool list:
    <a href="https://platform.realreal.cc/docs/mcp-usage">how to connect</a>.</p>
  </div>`
  return { subject, text, html }
}

export async function sendWelcomeEmail(p: {
  to: string; slug: string; siteUrl: string; mcpUrl: string; mcpToken: string
  // brandName drives the From display name + subject; falls back to slug so
  // pre-existing call sites/tests that omit it keep working (spec §12 Q5: v1
  // brand name = tenant slug, v1.5 reads site_contents.brand.name).
  brandName?: string
}): Promise<void> {
  const key = process.env.RESEND_API_KEY
  if (!key) { log.warn("RESEND_API_KEY missing; skipping welcome email"); return }
  const brandName = p.brandName ?? p.slug
  const { subject, text, html } = renderWelcomeEmail({
    brandName, slug: p.slug, siteUrl: p.siteUrl, mcpUrl: p.mcpUrl, mcpToken: p.mcpToken,
  })
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${brandName} <noreply@mail.platform.realreal.cc>`,
      to: p.to,
      subject,
      text,
      html,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`sendWelcomeEmail: ${res.status} ${await res.text()}`)
}

export async function alertOps(subject: string, body: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) { log.warn({ subject }, "SLACK_WEBHOOK_URL missing; alert dropped"); return }
  await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `:rotating_light: ${subject}\n${body}` }),
    signal: AbortSignal.timeout(10_000),
  }).catch(e => log.error({ e: String(e) }, "slack alert failed"))
}
