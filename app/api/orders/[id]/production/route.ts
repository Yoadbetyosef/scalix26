import { NextRequest, NextResponse } from 'next/server'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { sendToProduction } from '@/lib/orders/approvals'

// Explicit move to Production — never automatic. Only valid from Customer Approved or Factory Approved.
// The response carries WHO was notified so the caller can say so, or say that nobody was.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const r = await sendToProduction((await params).id, req.nextUrl.origin)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === 'not found' ? 404 : 400 })
  return NextResponse.json({ ok: true, notified: r.notified, reason: r.reason, detail: r.detail ?? null })
}
