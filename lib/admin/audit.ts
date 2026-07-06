import { createAdminClient } from '@/lib/supabase/server'

export interface AuditEntry {
  action: string
  targetType?: string
  targetId?: string | null
  targetLabel?: string | null
  before?: unknown
  after?: unknown
}

/**
 * Record an admin action to the generalized audit trail. Never throws — an audit failure
 * must not block the action itself (the write is best-effort).
 */
export async function logAdminAction(adminEmail: string, e: AuditEntry): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('admin_audit_log').insert({
      admin_email: adminEmail,
      action: e.action,
      target_type: e.targetType ?? null,
      target_id: e.targetId ?? null,
      target_label: e.targetLabel ?? null,
      before: e.before ?? null,
      after: e.after ?? null,
    })
  } catch {
    /* best-effort */
  }
}
