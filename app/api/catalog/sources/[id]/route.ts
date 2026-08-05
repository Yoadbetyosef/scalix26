import { NextRequest, NextResponse } from 'next/server'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { deleteSource, getSource } from '@/lib/catalog/sources'

// Disconnecting a website. The source stops syncing and its products stop counting — but nothing is
// deleted, here or anywhere else in this module. A tenant who disconnects by mistake gets everything
// back by reconnecting the same URL.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const result = await deleteSource(s.tenantId, id)
  if (!result.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, deactivated: result.deactivated })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const source = await getSource(s.tenantId, id)
  if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ source })
}
