import { createAdminClient } from '@/lib/supabase/server'

export interface PartnerAuditEntry {
  action: string
  targetType?: string
  targetId?: string | null
  before?: unknown
  after?: unknown
}

/**
 * Record a partner action to the partner audit trail. Never throws — an audit failure must not
 * block the action itself (best-effort). Mirrors lib/admin/audit.ts.
 */
export async function logPartnerAction(partnerId: string | null, actor: string, e: PartnerAuditEntry): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('partner_audit_log').insert({
      partner_id: partnerId,
      actor,
      action: e.action,
      target_type: e.targetType ?? null,
      target_id: e.targetId ?? null,
      before: e.before ?? null,
      after: e.after ?? null,
    })
  } catch {
    /* best-effort */
  }
}
