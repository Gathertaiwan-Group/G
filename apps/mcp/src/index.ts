import express from "express"
import cors from "cors"
import pino from "pino"
import { resolveTenant, AuthError } from "./lib/auth"
import { handleMcpRequest } from "./server"

const logger = pino({
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
})

const app = express()

// Middleware
app.use(cors({ origin: "*" }))
app.use(express.json())

// Request logger (manual, since pino-http is not in deps)
app.use((req, _res, next) => {
  logger.info({ method: req.method, url: req.url }, "incoming request")
  next()
})

// Health check — no auth required
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "mcp", ts: new Date().toISOString() })
})

// MCP endpoint — auth required
app.all("/mcp", async (req, res) => {
  const authHeader = req.headers["authorization"] ?? ""
  try {
    const ctx = await resolveTenant(String(authHeader))
    await handleMcpRequest(req, res, ctx)
  } catch (err) {
    if (err instanceof AuthError) {
      logger.warn({ msg: err.message }, "auth rejected")
      res.status(401).json({ error: err.message })
      return
    }
    logger.error({ err }, "unhandled error in /mcp")
    res.status(500).json({ error: "Internal server error" })
  }
})

const PORT = parseInt(process.env.PORT ?? "3002", 10)

app.listen(PORT, () => {
  logger.info({ port: PORT }, "MCP server listening")
})

export { app }
