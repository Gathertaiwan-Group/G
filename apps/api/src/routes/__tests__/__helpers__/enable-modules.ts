/**
 * Test helper: make a supabase.from mock return module_config with the given
 * modules enabled, then delegate all other tables to the provided fallback.
 *
 * Usage:
 *   vi.mocked(supabase.from).mockImplementation(
 *     withModulesEnabled({ subscriptions: true }, (table) => buildMyQuery(table))
 *   )
 */
export function withModulesEnabled(
  modules: Record<string, boolean>,
  fallback: (table: string) => unknown,
): (table: string) => unknown {
  return (table: string) => {
    if (table === "site_contents") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { value: modules }, error: null }),
          }),
        }),
      }
    }
    return fallback(table)
  }
}

/**
 * Simpler variant: wrap a single `mockReturnValue` call so that
 * site_contents always returns enabled modules, and all other `from()` calls
 * return `queryMock`.
 */
export function moduleEnabledFrom(
  modules: Record<string, boolean>,
  queryMock: unknown,
): (table: string) => unknown {
  return withModulesEnabled(modules, () => queryMock)
}
