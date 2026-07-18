import { NextRequest, NextResponse } from 'next/server'
import { requireCoreTenant } from '@/lib/core/guard'
import { getSubjectTimeline } from '@/lib/core/activities'
import { listFiles } from '@/lib/core/files'

// GET /api/core/products/[id]/activity — the product's unified activity timeline + attached files, using the
// generic activity/file layer (subject_type='product'). Read-only. Commerce-gated; tenant from the guard.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('commerce')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const id = (await params).id
  const [activities, files] = await Promise.all([getSubjectTimeline(c.tenantId, 'product', id), listFiles(c.tenantId, 'product', id)])
  return NextResponse.json({ activities, files })
}
