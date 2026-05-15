import express from "express"
import pino from "pino"
import { auditRouter } from "./routes/audit"
import { stripeWebhookRouter } from "./webhooks/stripe"
import { startRunner, stopRunner } from "./jobs/runner"
import { scheduleHealthCheck } from "./cron/health-check"
import { scheduleResendDkimVerify } from "./cron/resend-dkim-verify"
import { scheduleStripeSync } from "./cron/stripe-sync"
import { scheduleStuckJobSweep } from "./cron/stuck-job-sweep"

const log = pino({ name: "workers" })

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`required env var ${name} is not set`)
  return v
}

function buildApp(): express.Express {
  const app = express()

  // Stripe webhook needs the RAW request body for signature verification, so
  // it MUST be mounted before the global json parser. Each downstream router
  // that needs JSON parses it itself (see routes/audit.ts).
  app.use("/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookRouter)

  app.use("/internal/audit", auditRouter)

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "workers",
      uptime_seconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    })
  })

  return app
}

export { buildApp }

async function main(): Promise<void> {
  // Fail fast on missing required config.
  requireEnv("INTERNAL_API_SECRET")
  requireEnv("CONTROL_DB_URL")
  requireEnv("CONTROL_DB_SERVICE_ROLE_KEY")

  const port = Number(process.env.PORT ?? 4001)
  const app = buildApp()

  const server = app.listen(port, () => {
    log.info({ port }, "workers http server listening")
  })

  startRunner()
  const tasks = [
    scheduleHealthCheck(),
    scheduleResendDkimVerify(),
    scheduleStripeSync(),
    scheduleStuckJobSweep(),
  ]

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down workers")
    for (const t of tasks) {
      try {
        t.stop()
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : err }, "failed to stop cron task")
      }
    }
    await stopRunner()
    server.close(err => {
      if (err) log.error({ err: err.message }, "http server close error")
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  }
  process.on("SIGINT", () => void shutdown("SIGINT"))
  process.on("SIGTERM", () => void shutdown("SIGTERM"))
}

// Only run main when this file is the entrypoint (not when imported by tests).
if (require.main === module) {
  main().catch(err => {
    log.error({ err: err instanceof Error ? err.message : err }, "workers boot failed")
    process.exit(1)
  })
}
