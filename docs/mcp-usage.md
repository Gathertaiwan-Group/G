# Connecting your AI agent (MCP)

> Spec §8. Each tenant runs its own MCP server. Your own LLM (Claude
> Desktop / Claude Code / Cursor) connects to it with the bearer token from
> your welcome email and manages your site in natural language.
>
> This catalog is generated from the real server
> (`apps/mcp/src/server.ts` + `apps/mcp/src/tools/*`). It documents the
> **exact 7 tools** the server registers — no more, no less.

## What you need

- Your **MCP endpoint** (from the welcome email), e.g.
  `https://mcp-<slug>.up.railway.app/mcp`.
- Your **MCP token** (from the welcome email, **shown once**). The platform
  stores only a one-way hash of it (spec §8) — it cannot be re-displayed.
  Lost it? Contact support — the platform admin will rotate and re-issue it
  (your old token stops working immediately;
  see `docs/runbooks/mcp-token-leak.md`).

## Connect (Claude Code example)

```json
{
  "mcpServers": {
    "my-site": {
      "url": "https://mcp-<slug>.up.railway.app/mcp",
      "headers": { "Authorization": "Bearer <your-mcp-token>" }
    }
  }
}
```

Claude Desktop / Cursor: add the same URL + `Authorization: Bearer` header
in their MCP server settings. Transport is **Streamable HTTP (stateless)** —
every request must carry the `Authorization` header (no session is kept
between requests). Only tenants whose status is `active` can connect.

## What your agent can do (v1 tool catalog — exactly 7 tools)

| Tool | Read/Write | Parameters | What it does |
|---|---|---|---|
| `get_brand` | read | *(none)* | Returns the current brand configuration for your storefront (name, logo, colours, font, tagline). Returns sensible defaults if none is set. |
| `update_brand` | write | `patch`: an object with any of `name` (1–80 chars), `tagline` (≤200), `logo_url`, `favicon_url`, `colors` (`primary`, `primary_foreground`, `accent`, `background`, `foreground`), `font_family` | Deep-merges the patch into the current brand, validates the result, and persists it. Returns the full updated brand. |
| `list_modules` | read | *(none)* | Returns every module's enable/disable state for your site, merged with registry metadata (`required_modules`, the `mcp_tools` each module exposes). |
| `set_module_enabled` | write | `module` (a valid module key), `enabled` (boolean) | Enables or disables a module. Rejects if enabling would leave a required dependency disabled, or if disabling a module another enabled module depends on (the error explains which module to fix first). |
| `update_homepage_copy` | write | `key` (one of `hero`, `banner`, `section_titles`, `membership_image`), `value` (an object) | Stores a homepage content block under `site_contents` keyed `homepage_<key>`. Returns the stored key + value. |
| `list_orders` | **read-only** | `limit` (1–200, default 50, optional), `status` (optional filter) | Returns recent orders for your storefront, newest first (`id`, `total`, `status`, `created_at`, `customer_email`). |
| `list_products` | **read-only** | `limit` (1–500, default 100, optional) | Returns products for your storefront, newest first (`id`, `slug`, `name`, `price`, `in_stock`). |

> There are no other tools. There is no create/delete-product tool, no
> coupon/campaign/posts/reviews tool, and no payment-config tool in v1 —
> the seven above are the entire surface. (`list_modules` shows which extra
> `mcp_tools` each module advertises for future versions; only the seven
> listed here are wired into the v1 server.)

Example prompts that map onto these tools:

- "Make the brand primary colour dark green and the tagline 'Fresh daily'."
  → `update_brand`
- "What's enabled on my site, and turn on the courses module."
  → `list_modules` then `set_module_enabled`
- "Update the homepage hero to a spring theme." → `update_homepage_copy`
- "Show me the last 20 orders that are still `pending`." → `list_orders`

## Limits & safety

- Your agent acts as your site's admin **only**. The token resolves to
  exactly one tenant; the server connects to *your* database and nothing
  else — it cannot see or touch any other customer or the platform
  (spec §8 boundary rules).
- Write tools validate input before persisting (e.g. `update_brand` runs
  the full brand schema; `set_module_enabled` enforces dependencies).
- v1 ships **no rate limiting** on the MCP server. Be considerate with
  automated/looping agents; aggressive polling may be rate-limited in a
  future version.

## Trouble

- `401 Unauthorized` → missing/invalid `Authorization` header, an unknown
  or rotated token, or your tenant is not `active`. Re-check the header;
  if the token was rotated, get the fresh one from support.
- `500 Internal server error` → an unexpected server-side error; retry, and
  contact support if it persists.
- A tool returns an error like *"Cannot enable 'X': required module 'Y' is
  disabled"* → enable the dependency first, then retry.
