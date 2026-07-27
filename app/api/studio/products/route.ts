import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireStudioTenant } from '@/lib/studio/session'
import { sanitizeProduct } from '@/lib/studio/sanitize'

// GET /api/studio/products — all products for the caller's tenant (client filters/searches).
export async function GET() {
  const s = await requireStudioTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createAdminClient()
  const { data, error } = await db
    .from('studio_products')
    .select('*, variants:studio_variants(id)')
    .eq('tenant_id', s.tenantId)
    .order('created_at', { ascending: false })
    .limit(5000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ products: data || [] })
}

// POST /api/studio/products — create a product for the caller's tenant.
export async function POST(req: NextRequest) {
  const s = await requireStudioTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const db = createAdminClient()
  const { data, error } = await db
    .from('studio_products')
    .insert({ tenant_id: s.tenantId, ...sanitizeProduct(body) })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ product: data })
}
