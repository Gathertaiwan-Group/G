import type { SupabaseClient } from "@supabase/supabase-js"
import { tenants, infrastructure, loadKek } from "@realreal/control-db"
import type { TenantContext } from "./steps/types"

export async function loadTenantContext(
  client: SupabaseClient, tenantId: string,
): Promise<TenantContext> {
  const tenant = await tenants.getTenant(client, tenantId)
  if (!tenant) throw new Error(`tenant ${tenantId} not found`)
  const infra = await infrastructure.getInfrastructure(client, tenantId)
  return {
    client,
    tenant,
    infra,
    platformDomain: `${tenant.slug}.platform.realreal.cc`,
    kek: loadKek(),
  }
}
