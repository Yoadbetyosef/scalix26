import { NextRequest, NextResponse } from 'next/server'
import { requireCore } from '@/lib/core/guard'
import { retryInvoiceSync } from '@/lib/core/invoice-providers'

// Retry a failed provider sync for an internal invoice. Idempotent — never double-creates in the provider.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await params
  const r = await retryInvoiceSync(c.tenantId, c.actor, id, req.nextUrl.origin)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
