import { NextRequest, NextResponse } from 'next/server'
import { requireCore } from '@/lib/core/guard'
import { listDocuments, type DocType } from '@/lib/core/documents'

// GET /api/core/documents/[type] — list sales documents of a type (estimate|quote|invoice) for the tenant.
const TYPES = ['estimate', 'quote', 'invoice'] as const
const parseType = (t: string): DocType | null => (TYPES as readonly string[]).includes(t) ? (t as DocType) : null

export async function GET(_req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const t = parseType((await params).type)
  if (!t) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  return NextResponse.json({ documents: await listDocuments(c.tenantId, t) })
}
