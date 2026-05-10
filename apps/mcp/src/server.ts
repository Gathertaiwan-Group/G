/* eslint-disable @typescript-eslint/no-explicit-any */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { Request, Response } from "express"
import type { TenantContext } from "./lib/auth"
import * as getBrand from "./tools/get_brand"
import * as updateBrand from "./tools/update_brand"
import * as listModules from "./tools/list_modules"
import * as setModuleEnabled from "./tools/set_module_enabled"
import * as updateHomepageCopy from "./tools/update_homepage_copy"
import * as listOrders from "./tools/list_orders"
import * as listProducts from "./tools/list_products"

const TOOLS = [
  getBrand,
  updateBrand,
  listModules,
  setModuleEnabled,
  updateHomepageCopy,
  listOrders,
  listProducts,
]

/**
 * Handle a single /mcp request: spin up a per-request McpServer, register all
 * 7 tools with the injected TenantContext, then delegate to a stateless
 * StreamableHTTPServerTransport.
 */
export async function handleMcpRequest(
  req: Request,
  res: Response,
  ctx: TenantContext
): Promise<void> {
  const server = new McpServer({
    name: "realreal-storefront",
    version: "1.0.0",
  })

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        // Pass the full zod schema; SDK accepts z3.ZodTypeAny — cast to satisfy TS
        // when the SDK's z3 instance differs from ours (dual-package hazard)
        inputSchema: tool.inputSchema as any,
      },
      async (input: any) => {
        try {
          const result = await (tool.handler as any)(input, ctx)
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return {
            isError: true,
            content: [{ type: "text" as const, text: message }],
          }
        }
      }
    )
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  })

  await server.connect(transport)
  await transport.handleRequest(req as any, res as any, req.body)
}
