import { NextRequest, NextResponse } from 'next/server'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { enqueueSync, getSource } from '@/lib/catalog/sources'
import { enforce } from '@/lib/ratelimit'

// "Sync now". Enqueues; it does not crawl — nothing in a serverless function ever does.
//
// Rate limited per source rather than per tenant: a business with three shops should be able to
// refresh each of them, and the limit exists to stop someone hammering one site, not to ration the
// button. A sync already in flight is a no-op with a plain answer rather than a second crawl.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const source = await getSource(s.tenantId, id)
  if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const limited = await enforce('catalog_sync', `source:${id}`)
  if (limited) return limited

  const { queued, reason } = await enqueueSync(s.tenantId, id, 'manual')
  if (!queued && reason === 'already_running') {
    return NextResponse.json({ ok: true, queued: false, message: 'This site is already syncing.' })
  }
  if (!queued) return NextResponse.json({ error: reason ?? 'Could not queue that sync.' }, { status: 400 })

  return NextResponse.json({ ok: true, queued: true })
}
