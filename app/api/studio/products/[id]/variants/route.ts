import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireStudioTenant } from '@/lib/studio/session'
import { sanitizeVariant } from '@/lib/studio/sanitize'

// POST /api/studio/products/[id]/variants — add a variant (sub-product) to a product.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireStudioTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const db = createAdminClient()
  // Confirm the product belongs to this tenant before attaching a variant.
  const { data: product } = await db.from('studio_products').select('id').eq('id', id).eq('tenant_id', s.tenantId).maybeSingle()
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await db
    .from('studio_variants')
    .insert({ tenant_id: s.tenantId, product_id: id, ...sanitizeVariant(body) })
    .select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ variant: data })
}
