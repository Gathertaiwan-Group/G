import pino from "pino"
const log = pino({ name: "notify" })

export async function sendWelcomeEmail(p: {
  to: string; slug: string; siteUrl: string; mcpUrl: string; mcpToken: string
}): Promise<void> {
  const key = process.env.RESEND_API_KEY
  if (!key) { log.warn("RESEND_API_KEY missing; skipping welcome email"); return }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Platform <noreply@mail.platform.realreal.cc>",
      to: p.to,
      subject: `Your site ${p.slug} is live`,
      text: `Site: ${p.siteUrl}\nMCP endpoint: ${p.mcpUrl}\nMCP token (store securely, shown once): ${p.mcpToken}`,
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
