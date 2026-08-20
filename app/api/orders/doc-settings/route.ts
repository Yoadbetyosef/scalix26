import { NextRequest, NextResponse } from 'next/server'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { readDocSettings, writeDocSettings } from '@/lib/documents/doc-settings'

// Document branding (logo, colour, letterhead, terms, quote validity) for Estimates, Quotes and
// Invoices generated from orders.
//
// It reads and writes the SAME studio_doc_settings row as /api/studio/doc-settings — branding belongs to
// the business, not to a module, so a logo uploaded in either place shows up on every document. This
// route exists because that one is gated on the `studio` module, which a tenant running only Orders
// (TG jewellers, for one) doesn't have: without it the logo could never be set at all.

export async function GET() {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ settings: await readDocSettings(a.tenantId) })
}

export async function PUT(req: NextRequest) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { data, error } = await writeDocSettings(a.tenantId, body)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}
