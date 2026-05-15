// Recorded-shape Management-API fixtures for the L2 pipeline-chain test
// (PR-D10). These mirror the real JSON each Mgmt client returns so the chain
// test can drive all 8 step handlers with realistic data and zero network.
//
// NOTE ON SHAPES: the plan (2026-05-15) predates the merged client wrappers.
// The merged `infrastructure/provisioning/clients/*` return *adapted* shapes
// (e.g. createSupabaseProject -> { ref, url }; createRailwayService -> id
// string). The constants below keep the plan's recorded JSON intent but expose
// the values in the shape each merged client actually resolves, so the chain
// test wires mocks against real signatures. Adaptations are documented at the
// use site in pipeline-chain.test.ts.

export const SUPABASE_PROJECT = {
  ref: "ref_pioneer",
  url: "https://ref_pioneer.supabase.co",
}
export const SUPABASE_HEALTHY = { status: "ACTIVE_HEALTHY" }
export const SUPABASE_KEYS = { anon: "anon_key_x", serviceRole: "service_role_key_x" }

export const VERCEL_PROJECT = { id: "prj_pioneer" }
export const VERCEL_DEPLOY = {
  id: "dpl_pioneer",
  readyState: "READY",
  url: "https://pioneer.vercel.app",
}

export const RAILWAY_PROJECT = { id: "rprj_pioneer" }
// railway_setup queries the project's default environment, then calls
// serviceDomainCreate per service. `domain` is the bare host Railway returns;
// railway-setup.ts persists it as `https://<domain>`.
export const RAILWAY_ENVIRONMENT = { id: "env_pioneer_prod" }
export const RAILWAY_API_SVC = {
  id: "svc_api_pioneer",
  domain: "api-pioneer.up.railway.app",
  url: "https://api-pioneer.up.railway.app",
}
export const RAILWAY_MCP_SVC = {
  id: "svc_mcp_pioneer",
  domain: "mcp-pioneer.up.railway.app",
  url: "https://mcp-pioneer.up.railway.app",
}

export const RESEND_DOMAIN = {
  id: "dom_pioneer",
  records: [{ type: "TXT", name: "mail", value: "v=spf1 include:resend.com ~all" }],
}
