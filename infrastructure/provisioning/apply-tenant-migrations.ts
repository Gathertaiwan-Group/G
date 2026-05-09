import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

// ESM-safe __dirname (also works under tsx CJS)
const __dirname = dirname(fileURLToPath(import.meta.url))

const TOKEN = process.env.SUPABASE_PAT
const REF = process.env.TENANT_DB_REF
if (!TOKEN || !REF) {
  console.error("Set SUPABASE_PAT and TENANT_DB_REF")
  process.exit(1)
}

const MIGRATIONS_DIR = join(__dirname, "..", "..", "packages", "db", "migrations")
const HEADERS = {
  "Authorization": `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
  "User-Agent": "tenant-migrations/1.0",
}

async function runSql<T = unknown>(query: string, label: string): Promise<T> {
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
  return (await res.json()) as T
}

async function fetchApplied(): Promise<Set<string>> {
  // schema_migrations may not exist yet on the very first run; treat that
  // as "nothing applied yet" so 0015 can create the table.
  try {
    const rows = await runSql<{ filename: string }[]>(
      "select filename from schema_migrations",
      "list applied",
    )
    return new Set(rows.map((r) => r.filename))
  } catch {
    return new Set<string>()
  }
}

const BOOTSTRAP_FILE = "0015_schema_migrations.sql"

async function main() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()

  // Bootstrap: if schema_migrations does not exist yet (first run on a DB
  // that already had 0001-0014 applied historically), run 0015 FIRST so it
  // creates the tracking table and backfills the historical filenames. This
  // prevents the loop from trying to re-run non-idempotent 0001-0014.
  const initialApplied = await fetchApplied()
  if (initialApplied.size === 0) {
    const bootstrapPath = join(MIGRATIONS_DIR, BOOTSTRAP_FILE)
    await runSql(readFileSync(bootstrapPath, "utf8"), BOOTSTRAP_FILE)
    console.log(`✓ ${BOOTSTRAP_FILE} (bootstrap)`)
  }

  for (const f of files) {
    // Re-fetch the applied set on every iteration so 0015's backfill of
    // 0001-0014 takes effect before those filenames are checked.
    const applied = await fetchApplied()

    if (applied.has(f)) {
      console.log(`- skip ${f} (already applied)`)
      continue
    }

    await runSql(readFileSync(join(MIGRATIONS_DIR, f), "utf8"), f)
    console.log(`✓ ${f}`)
  }

  console.log("✓ tenant migrations up to date")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
