import { NextRequest, NextResponse } from 'next/server'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { convertDraft } from '@/lib/commerce/orders'

// Convert a Draft to a Customer Order. Transaction-safe + idempotent (repeated clicks return the same
// order). Requires the commerce.convert permission.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCommercePermission('commerce.convert')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const r = await convertDraft((await params).id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}
