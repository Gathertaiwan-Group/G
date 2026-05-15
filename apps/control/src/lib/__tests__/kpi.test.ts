import { describe, it, expect } from "vitest"
import { computeKpis } from "../kpi"

describe("computeKpis", () => {
  it("derives the spec §9 home KPIs from raw rows", () => {
    const out = computeKpis({
      activeTenants: 4,
      provisioningDurationsSec: [300, 360, 420, 999, 480], // p95 of 5 = the 5th smallest-ish
      tenant5xxLastHour: [{ tenant_id: "a", count: 2 }, { tenant_id: "b", count: 0 }],
      mcpCallsLastHour: [{ tenant_id: "a", total: 120, errors: 6 }],
      healthStreaks: [{ tenant_id: "a", failure_streak: 0 }, { tenant_id: "b", failure_streak: 3 }],
    })
    expect(out.tenant_count_active).toBe(4)
    expect(out.provisioning_p95_seconds).toBe(999)
    expect(out.tenant_5xx_total_last_hour).toBe(2)
    expect(out.mcp_tool_call_count_last_hour).toBe(120)
    expect(out.mcp_tool_call_error_rate).toBeCloseTo(0.05, 5)
    expect(out.max_health_failure_streak).toBe(3)
  })
  it("is safe on empty inputs (no NaN)", () => {
    const out = computeKpis({
      activeTenants: 0, provisioningDurationsSec: [],
      tenant5xxLastHour: [], mcpCallsLastHour: [], healthStreaks: [],
    })
    expect(out.provisioning_p95_seconds).toBe(0)
    expect(out.mcp_tool_call_error_rate).toBe(0)
  })
})
