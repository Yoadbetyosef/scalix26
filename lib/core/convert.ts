import { createAdminClient } from '@/lib/supabase/server'

// Idempotent, atomic document conversion via the core_convert_document RPC. Preserves contact/company/
// currency/tax/discount/totals + all lines (product/variant links + custom attributes). Documents stay
// INDEPENDENT after conversion. A repeated call with the same key returns the already-created target.
export interface ConvertResult { ok: boolean; error?: string; idempotent?: boolean; target_type?: string; target_id?: string; number?: string }

export async function convertDocument(tenantId: string, sourceType: string, sourceId: string, targetType: 'quote' | 'invoice', idempotencyKey: string, actor: string): Promise<ConvertResult> {
  const { data, error } = await createAdminClient().rpc('core_convert_document', {
    p_tenant: tenantId, p_source_type: sourceType, p_source_id: sourceId, p_target_type: targetType, p_key: idempotencyKey, p_actor: actor,
  })
  if (error) return { ok: false, error: error.message }
  return (data ?? { ok: false, error: 'no_result' }) as ConvertResult
}
