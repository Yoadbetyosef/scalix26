import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { enforce, clientIp } from '@/lib/ratelimit'
import { recordApprovalResponse } from '@/lib/orders/approvals'

// PUBLIC, unauthenticated. The token in the path is the only credential. Rate-limited (fail-closed), CSRF-safe
// (state-changing POST with a JSON body, no ambient cookies used). The raw token is never logged.
const schema = z.object({
  decision: z.enum(['approved', 'changes_requested', 'rejected']),
  comment: z.string().max(3000).nullable().optional(),
  estimatedCompletionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const flood = await enforce('orders_approval', `ip:${clientIp(req)}`)
  if (flood) return flood
  const token = (await params).token
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid response.' }, { status: 400 })
  const r = await recordApprovalResponse(token, parsed.data.decision, parsed.data.comment ?? null, parsed.data.estimatedCompletionDate ?? null)
  // Generic error surface (no token/tenant details).
  if (!r.ok) return NextResponse.json({ error: r.error ?? 'This approval link is no longer available.' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
