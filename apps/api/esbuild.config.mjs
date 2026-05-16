// Bundles the api service into a single self-contained CJS file.
//
// Why bundle instead of plain `tsc`: Phase B added imports of
// `@repo/modules` (used by app.ts / routes/tiers.ts / routes/coupons.ts /
// routes/campaigns.ts via `requireModule`). That workspace package ships RAW
// TypeScript source (its package.json is `"type": "module"` with `main`
// pointing at `./src/index.ts`, no build step). `node dist/index.js` (raw
// Node, no bundler/loader) cannot parse `.ts` and crashes at startup with
// `SyntaxError: Unexpected token 'export'` / `ERR_MODULE_NOT_FOUND`. esbuild
// resolves and inlines the workspace TS source at build time, leaving zero
// runtime workspace resolution. Same fix that was merged for apps/mcp in
// PR #30 and apps/workers in PR #57; touches nothing outside apps/api.
//
// pino / pino-pretty are kept external: pino uses worker threads and dynamic
// transport resolution that break when bundled (same as PR #57). They are
// regular (dev) dependencies present in node_modules at runtime / dev
// (installed via `npm install --workspaces`).
//
// The other third-party runtime deps (express, @supabase/supabase-js, bullmq,
// ioredis, axios, multer, resend, zod) are ALSO present in node_modules at
// runtime via `npm install --workspaces`, so they are left external too —
// bullmq/ioredis in particular pull in optional/native-ish transitive code
// that is safest unbundled. Only the raw-TS workspace dep (@repo/modules),
// which has NO build output, MUST be inlined by esbuild — that is the entire
// point of this bundle step.
import { build } from "esbuild"

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  external: [
    "pino",
    "pino-pretty",
    "express",
    "@supabase/supabase-js",
    "bullmq",
    "ioredis",
    "axios",
    "multer",
    "resend",
    "zod",
  ],
  logLevel: "info",
})
