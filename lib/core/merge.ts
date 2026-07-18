import { createAdminClient } from '@/lib/supabase/server'

// Atomic contact merge via the core_merge_contacts RPC (single transaction: repoint every linked record,
// preserve history, mark the loser merged). Idempotent — re-merging a merged loser is a no-op.
export interface MergeResult { ok: boolean; error?: string; idempotent?: boolean; winner?: string; loser?: string; moved?: Record<string, number> }

export async function mergeContacts(tenantId: string, winnerId: string, loserId: string, actor: string): Promise<MergeResult> {
  const { data, error } = await createAdminClient().rpc('core_merge_contacts', { p_tenant: tenantId, p_winner: winnerId, p_loser: loserId, p_actor: actor })
  if (error) return { ok: false, error: error.message }
  return (data ?? { ok: false, error: 'no_result' }) as MergeResult
}
