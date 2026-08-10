import { NextRequest, NextResponse } from 'next/server'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { findOrCreateSupplier, listSuppliers } from '@/lib/orders/suppliers'

// The factory address book. Same access gate as orders — a supplier list is order data.
export async function GET(req: NextRequest) {
  if (!(await requireOrdersAccess())) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ suppliers: await listSuppliers(req.nextUrl.searchParams.get('q') ?? undefined) })
}

export async function POST(req: NextRequest) {
  if (!(await requireOrdersAccess())) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const s = (v: unknown) => (typeof v === 'string' ? v : null)
  const { supplier, error } = await findOrCreateSupplier({
    name: s(body.name) ?? '', contactName: s(body.contactName), email: s(body.email), phone: s(body.phone), notes: s(body.notes),
  })
  if (error) return NextResponse.json({ error }, { status: 400 })
  return NextResponse.json({ supplier })
}
