import { NextRequest, NextResponse } from 'next/server'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { listSources, upsertSource, enqueueSync, countProducts } from '@/lib/catalog/sources'
import { detectPlatform, DEFAULT_DETECT_BUDGET_MS } from '@/lib/ingestion/detector'
import { enforceAll, clientIp } from '@/lib/ratelimit'

// Connecting a website. Detection runs here because the answer is worth waiting a few seconds for —
// the tenant should see "Shopify, about 240 products" rather than a spinner that resolves minutes
// later. It runs under a hard 12-second budget: this is a serverless function, and a six-tier probe
// of a slow site would outlive it. When the budget runs out the source is left for the worker, which
// has no such limit, and the UI polls.
export const maxDuration = 30

export async function GET() {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sources = await listSources(s.tenantId)
  return NextResponse.json({ sources, productCount: await countProducts(s.tenantId) })
}

export async function POST(req: NextRequest) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Detection makes outbound requests to a URL the caller chose, so it is rate limited on the same
  // policy as the other website scanners in this codebase.
  const limited = await enforceAll([
    { policy: 'scan_website', id: `tenant:${s.tenantId}` },
    { policy: 'scan_website', id: `ip:${clientIp(req)}` },
  ])
  if (limited) return limited

  let body: { url?: string; ownershipConfirmed?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const url = (body.url ?? '').trim()
  if (!url) return NextResponse.json({ error: 'Enter your website address.' }, { status: 400 })
  // Not a checkbox we can shrug off: it is the tenant stating they are entitled to this content.
  if (body.ownershipConfirmed !== true) {
    return NextResponse.json({ error: 'Please confirm you own or are authorized to use this website.' }, { status: 400 })
  }

  const detection = await detectPlatform(url, { budgetMs: DEFAULT_DETECT_BUDGET_MS }).catch(() => null)

  const { source, error } = await upsertSource({
    tenantId: s.tenantId, url, detection, ownershipConfirmed: true,
  })
  if (error || !source) return NextResponse.json({ error: error ?? 'Could not save that source.' }, { status: 400 })

  // Queued whenever there is something to read — including the undetected case, where the worker
  // will look again with a longer budget. A site we know we cannot read is not queued.
  const shouldQueue = Boolean(detection?.sourceType) || !detection?.reason
  if (shouldQueue) await enqueueSync(s.tenantId, source.id, 'initial')

  return NextResponse.json({
    source,
    detected: detection ? {
      sourceType: detection.sourceType,
      platform: detection.platform,
      confidence: detection.confidence,
      estimatedProducts: detection.estimatedProducts,
      reason: detection.reason ?? null,
    } : null,
    queued: shouldQueue,
  })
}
