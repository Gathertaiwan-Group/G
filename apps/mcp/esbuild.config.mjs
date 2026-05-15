// Bundles the MCP server into a single self-contained CJS file.
//
// Why bundle instead of plain `tsc`: this app depends on workspace packages
// (@repo/theme, @repo/modules — including the deep import
// `@repo/modules/src/registry`) that ship raw ESM TypeScript source with
// extensionless relative imports and no build step. `node dist/index.js`
// (raw Node, no bundler/loader) cannot resolve those, so a tsc-only build
// crashes at startup with ERR_MODULE_NOT_FOUND. esbuild resolves and inlines
// the workspace source at build time, leaving zero runtime workspace
// resolution — and touches nothing outside apps/mcp, so the live realreal
// storefront (apps/web) is unaffected.
//
// pino / pino-http are kept external: pino uses worker threads and dynamic
// transport resolution that break when bundled. They are regular
// dependencies present in node_modules at runtime.
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
