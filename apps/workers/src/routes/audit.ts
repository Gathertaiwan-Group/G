import express, { Router, type Request, type Response, type NextFunction } from "express"
import { verifySignature } from "../lib/hmac"
import { createControlClient, audit, type AuditEntry } from "@realreal/control-db"

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: string
    }
  }
}

const VALID_ACTORS = new Set(["platform_admin", "customer_agent", "system", "customer_user"])

// JSON parser that also captures the raw body string for HMAC verification.
const jsonWithRaw = express.json({
  verify: (req: Request, _res, buf) => {
    req.rawBody = buf.toString("utf8")
  },
})

function requireSignature(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) {
    res.status(500).json({ error: "internal_secret_not_configured" })
    return
  }
  const sig = req.header("x-internal-signature") ?? ""
  const raw = req.rawBody ?? ""
  if (!sig || !verifySignature(raw, sig, secret)) {
    res.status(401).json({ error: "invalid_signature" })
    return
  }
  next()
}

function isValidEntry(b: unknown): b is AuditEntry {
  if (!b || typeof b !== "object") return false
  const o = b as Record<string, unknown>
  if (o.tenant_id !== null && typeof o.tenant_id !== "string") return false
  if (typeof o.actor_type !== "string" || !VALID_ACTORS.has(o.actor_type)) return false
  if (o.actor_id !== null && typeof o.actor_id !== "string") return false
  if (typeof o.action !== "string" || o.action.length === 0) return false
  if (o.resource !== null && typeof o.resource !== "string") return false
  return true
}

export const auditRouter = Router()

auditRouter.post("/", jsonWithRaw, requireSignature, async (req: Request, res: Response) => {
  const body = req.body
  if (!isValidEntry(body)) {
    res.status(400).json({ error: "invalid_entry" })
    return
  }
  try {
    const client = createControlClient()
    await audit.emitAudit(client, body)
    res.status(202).json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error"
    res.status(500).json({ error: "audit_write_failed", detail: msg })
  }
})
