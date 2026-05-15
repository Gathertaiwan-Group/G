import type { SupabaseClient } from "@supabase/supabase-js"

/** Returns true if this is the FIRST time we've seen event_id (caller should
 * process). Returns false if it was already recorded (caller should skip). */
export async function recordStripeEvent(
  c: SupabaseClient, eventId: string, type: string, payload: unknown,
): Promise<boolean> {
  const { error } = await c.from("stripe_webhook_events")
    .insert({ event_id: eventId, type, payload })
  if (!error) return true
  // 23505 = unique_violation on event_id PK → duplicate delivery.
  if ((error as { code?: string }).code === "23505") return false
  throw error
}
