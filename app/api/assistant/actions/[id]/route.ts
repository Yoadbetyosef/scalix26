import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { executeAction } from '@/lib/assistant/execute'

// POST /api/assistant/actions/[id] — body { action: 'confirm' | 'cancel' }.
// confirm → execute the real backend action and record the true result.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Resolve the ACTIVE business (handles White Label operator mode) — NOT the caller's own tenant,
  // so a partner acting on a client's assistant action targets the client, not themselves.
  const ctx = await requireActiveBusinessContext()
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 403 })

  const db = createAdminClient()
  const { id } = await params

  let body: { action?: string }
  try { body = await req.json() } catch { body = {} }

  if (body.action === 'cancel') {
    await db.from('assistant_actions').update({ status: 'cancelled' }).eq('id', id).eq('tenant_id', ctx.tenantId).eq('status', 'pending')
    return NextResponse.json({ ok: true, status: 'cancelled' })
  }

  // Default: confirm + execute.
  const result = await executeAction(id, ctx.tenantId, ctx.actorUserId)
  return NextResponse.json(result)
}
