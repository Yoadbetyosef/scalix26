import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireCatalogTenant } from '@/lib/catalog/session'

const HEADERS = ['name', 'sku', 'category', 'brand', 'price', 'showroom_quantity', 'warehouse_quantity', 'storage_quantity', 'incoming_quantity', 'expected_arrival_date', 'availability_status', 'notes'] as const
const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

// GET /api/catalog/export — the caller tenant's catalog as CSV.
export async function GET() {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createAdminClient()
  const { data, error } = await db.from('catalog_products').select('*').eq('tenant_id', s.tenantId).order('name').limit(5000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = [HEADERS.join(',')]
  for (const p of data || []) {
    rows.push([p.name, p.sku, p.category, p.brand, p.price, p.showroom_quantity, p.warehouse_quantity, p.storage_quantity, p.incoming_quantity, p.expected_arrival_date, p.availability_status, p.internal_notes].map(cell).join(','))
  }
  return new NextResponse(rows.join('\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="catalog.csv"' },
  })
}
