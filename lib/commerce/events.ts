import { createClient } from '@/lib/supabase/server'

// Append a commerce timeline/audit event. Tenant comes from RLS (get_tenant_id via the user JWT).
// For financial & inventory events, include before/after in `payload` (§19).
export async function addCommerceEvent(
  tenantId: string,
  entityType: string,
  entityId: string | null,
  type: string,
  payload: Record<string, unknown> | null,
  actor?: string | null,
): Promise<void> {
  const sb = await createClient()
  await sb.from('commerce_events').insert({
    tenant_id: tenantId, entity_type: entityType, entity_id: entityId, type, payload: payload ?? null, actor: actor ?? null,
  })
}
