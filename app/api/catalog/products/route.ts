import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { sanitizeProduct, sanitizeCostInput } from '@/lib/catalog/sanitize'
import { syncStudioFromCatalog, fabricFromBody } from '@/lib/studio/link'
import { createProductWithCost } from '@/lib/catalog/costs'
import { requireActiveBusinessContext } from '@/lib/workspace'

// GET /api/catalog/products — all products for the caller's tenant (client filters/searches).
export async function GET() {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createAdminClient()
  const { data, error } = await db.from('catalog_products').select('*').eq('tenant_id', s.tenantId).order('created_at', { ascending: false }).limit(5000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ products: data || [] })
}

// POST /api/catalog/products — create a product for the caller's tenant.
export async function POST(req: NextRequest) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // A cost entered on the Add form travels with the product and is written in the SAME transaction —
  // see add_product_with_cost_rpc.sql. Either both rows land or neither does, so a product can never
  // be saved without the cost its owner typed into it. Submitting no cost is still an ordinary
  // outcome: p_cost goes null, the product is created alone, and the cost card is waiting on arrival.
  const cost = sanitizeCostInput(body.cost)
  const actor = cost ? (await requireActiveBusinessContext())?.actorUserId ?? null : null

  const db = createAdminClient()
  // The RPC returns the product row it created — the same shape the insert used to return, so the
  // Studio sync and the response below are unchanged.
  let data: { id: string } & Record<string, unknown>
  try {
    const created = await createProductWithCost(s.tenantId, sanitizeProduct(body), cost, actor)
    if (!created.ok) {
      // A session that may not record costs must not have its cost silently dropped — the product is
      // refused too, and the message says which half was the problem.
      return NextResponse.json({ error: 'You are not allowed to record costs.' }, { status: 403 })
    }
    data = created.data as { id: string } & Record<string, unknown>
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
  // Auto-create the Studio counterpart (+ apply the chosen fabric) so the product gains the Studio
  // experience from the moment it's added. Non-fatal.
  try { await syncStudioFromCatalog(db, s.tenantId, data, fabricFromBody(body)) } catch { /* studio sync is best-effort */ }
  return NextResponse.json({ product: data })
}
