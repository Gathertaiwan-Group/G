import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

// ESM-safe __dirname (also works under tsx CJS)
const __dirname = dirname(fileURLToPath(import.meta.url))

const TOKEN = process.env.SUPABASE_PAT
const REF = process.env.CONTROL_DB_REF
if (!TOKEN || !REF) {
  console.error("Set SUPABASE_PAT and CONTROL_DB_REF")
  process.exit(1)
}

const MIGRATIONS_DIR = join(__dirname, "..", "..", "packages", "control-db", "migrations")
const HEADERS = {
  "Authorization": `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
  "User-Agent": "control-migrations/1.0",
}

// NOTE (one-time bootstrap): the control DB is fresh, so the v1 migrations
// rely on `create table if not exists` + idempotent constraint changes. If
// constraint definitions diverge from a previous run, drop the affected
// tables in the control DB and re-run this script — safe while no real
// data exists. Subsequent schema changes must be additive migrations.
async function runSql(query: string, label: string) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${REF}/database/query`,
    {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (!res.ok) {
    throw new Error(`${label}: ${await res.text()}`)
  }
  console.log(`✓ ${label}`)
}

async function main() {
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort()
  for (const f of files) {
    await runSql(readFileSync(join(MIGRATIONS_DIR, f), "utf8"), f)
  }

  // Verify
  await runSql(
    "select tablename from pg_tables where schemaname='public' order by tablename",
    "verify schema",
  )
  console.log("✓ control DB ready")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
