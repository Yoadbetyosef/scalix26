import { createAdminClient } from '@/lib/supabase/server'

// Proposal activity timeline. Internal-only (never rendered on the public page). Every meaningful proposal
// event lands here so the builder shows a real history.
const admin = () => createAdminClient()

export type ProposalEvent =
  | 'created' | 'customer_changed' | 'item_added' | 'item_edited' | 'item_removed' | 'previewed'
  | 'email_attempted' | 'email_sent' | 'email_failed' | 'viewed' | 'accepted' | 'declined' | 'expired'
  | 'updated_after_send' | 'converted_invoice' | 'converted_order' | 'archived' | 'duplicated' | 'template_changed'

export async function logActivity(tenantId: string, proposalId: string, event: ProposalEvent, opts: { actor?: string | null; message?: string | null; meta?: Record<string, unknown> } = {}): Promise<void> {
  await admin().from('proposal_activity').insert({
    tenant_id: tenantId, proposal_id: proposalId, event_type: event,
    actor: opts.actor ?? null, message: opts.message ?? null, meta: opts.meta ?? {},
  })
}

export async function listActivity(tenantId: string, proposalId: string, limit = 100) {
  const { data } = await admin().from('proposal_activity').select('id, event_type, actor, message, meta, created_at')
    .eq('tenant_id', tenantId).eq('proposal_id', proposalId).order('created_at', { ascending: false }).limit(limit)
  return data ?? []
}
