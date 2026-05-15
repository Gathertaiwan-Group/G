// Bundles the workers service into a single self-contained CJS file.
//
// Why bundle instead of plain `tsc`: Phase D added imports of
// `@realreal/provisioning/clients/*` into the step handlers. That workspace
// package ships RAW TypeScript source (its package.json `exports` map points
// at `./clients/*.ts` with no build step). `node dist/index.js` (raw Node, no
// bundler/loader) cannot parse `.ts` and crashes at startup with
// `SyntaxError: Unexpected token 'export'`. esbuild resolves and inlines the
// workspace TS source at build time, leaving zero runtime workspace
// resolution. Same fix that was merged for apps/mcp in PR #30; touches
// nothing outside apps/workers.
//
// pino is kept external: pino uses worker threads and dynamic transport
// resolution that break when bundled. It is a regular dependency present in
// node_modules at runtime (installed via `npm install --workspaces`).
import { build } from "esbuild"

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  external: ["pino", "pino-http"],
  logLevel: "info",
})
