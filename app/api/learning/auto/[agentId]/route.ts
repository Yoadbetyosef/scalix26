import { NextRequest, NextResponse } from 'next/server'
import { authAgent, isAuthError } from '@/lib/playbook/data'
import { scanForSuggestions } from '@/lib/playbook/suggestions'

export const maxDuration = 60

// Auto-learn trigger. Fired (fire-and-forget) when the owner opens the employee page
// after connecting a channel: the AI learns automatically from the REAL conversations
// that channel brings — the owner never runs a manual training questionnaire.
//
// This does NOT touch how the AI learns: it only calls the existing scanForSuggestions
// (the untouched learning pass) and decides WHEN it runs. A per-tenant watermark in
// learning_cursors throttles it so repeated page loads don't re-run it.
const THROTTLE_MS = 6 * 60 * 60 * 1000 // 6h — new activity is picked up on the next window
const CURSOR = 'auto_scan'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  const ctx = await authAgent(agentId)
  if (isAuthError(ctx)) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { admin, tenantId } = ctx

  // Throttle: skip if we learned recently. (If the table isn't migrated, the read fails
  // silently and we proceed — the client fires this at most once per page load anyway.)
  try {
    const { data: cur } = await admin
      .from('learning_cursors')
      .select('last_processed_at')
      .eq('tenant_id', tenantId).eq('source', CURSOR).maybeSingle()
    const last = cur?.last_processed_at ? new Date(cur.last_processed_at).getTime() : 0
    if (last && Date.now() - last < THROTTLE_MS) {
      return NextResponse.json({ ran: false, reason: 'throttled' })
    }
  } catch { /* table may not exist yet — fall through and run */ }

  // Only learn when there is real conversation data to learn from.
  const { count: convCount } = await admin
    .from('conversations').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
  if (!convCount) return NextResponse.json({ ran: false, reason: 'no_data' })

  const { added, paused, message } = await scanForSuggestions(ctx)

  // Advance the watermark so we don't re-learn on every page load. (Not when paused — let it
  // retry sooner once budget frees up.)
  if (!paused) {
    try {
      await admin.from('learning_cursors')
        .upsert({ tenant_id: tenantId, source: CURSOR, last_processed_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          { onConflict: 'tenant_id,source' })
    } catch { /* best-effort */ }
  }

  return NextResponse.json({ ran: true, added, paused: !!paused, message: message || null })
}
