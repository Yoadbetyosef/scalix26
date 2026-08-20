import { NextRequest, NextResponse } from 'next/server'
import { requireStudioTenant } from '@/lib/studio/session'
import { readDocSettings, writeDocSettings } from '@/lib/documents/doc-settings'

// GET /api/studio/doc-settings — the tenant's document branding (logo, colour, letterhead, terms, validity).
export async function GET() {
  const s = await requireStudioTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ settings: await readDocSettings(s.tenantId) })
}

// PUT /api/studio/doc-settings — upsert the tenant's document branding.
export async function PUT(req: NextRequest) {
  const s = await requireStudioTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { data, error } = await writeDocSettings(s.tenantId, body)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}
