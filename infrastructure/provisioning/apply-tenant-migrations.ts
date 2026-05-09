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
  // schema_migrations may not exist yet on the very first run; treat ONLY
  // that specific case as "nothing applied yet" so the bootstrap path below
  // can apply 0015 (which creates the tracking table and backfills the
  // historical filenames). All other failures (auth, network, malformed
  // response, etc.) MUST propagate — swallowing them would silently return
  // an empty set and re-apply non-idempotent migrations on transient errors.
  try {
    const rows = await runSql<Array<{ filename: string }>>(
      "select filename from schema_migrations",
      "list applied migrations",
    )
    if (!Array.isArray(rows)) {
      throw new Error(
        "schema_migrations query returned non-array: " + JSON.stringify(rows),
      )
    }
    return new Set(rows.map((r) => r.filename))
  } catch (err) {
    const msg = String((err as Error).message ?? err)
    // Only swallow the specific "table does not exist" case (Postgres 42P01).
    if (
      msg.includes("schema_migrations") &&
      (msg.includes("does not exist") || msg.includes("42P01"))
    ) {
      return new Set<string>()
    }
    throw err
  }
}

const BOOTSTRAP_FILE = "0015_schema_migrations.sql"

async function main() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()

  // Bootstrap: if schema_migrations does not exist yet (first run on a DB
  // that already had 0001-0014 applied historically), run 0015 FIRST so it
  // creates the tracking table and backfills the historical filenames. This
  // prevents the loop from trying to re-run non-idempotent 0001-0014.
  //
  // Note: 0015's SQL ends with an INSERT that self-registers '0015_schema_migrations.sql'
  // into schema_migrations, so the loop below will see it in `applied` and
  // correctly skip it on the next iteration — no double-apply.
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
