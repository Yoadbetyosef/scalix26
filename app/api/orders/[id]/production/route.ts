import { NextRequest, NextResponse } from 'next/server'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { sendToProduction } from '@/lib/orders/approvals'

// Explicit "Send to Production" — never automatic. Only valid from Customer Approved.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const r = await sendToProduction((await params).id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === 'not found' ? 404 : 400 })
  return NextResponse.json({ ok: true })
}
