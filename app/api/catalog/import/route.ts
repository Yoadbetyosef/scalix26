import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { isAvailabilityStatus } from '@/lib/catalog/types'

// Minimal CSV line parser (handles quoted fields + escaped quotes + commas).
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

// POST /api/catalog/import — bulk-create products from CSV. Body: { csv: string }.
// Headers: name, sku, category, brand, price, showroom_quantity, warehouse_quantity,
// storage_quantity, incoming_quantity, expected_arrival_date, availability_status, notes.
export async function POST(req: NextRequest) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let csv = ''
  try { csv = String((await req.json()).csv || '') } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const rows = parseCsv(csv)
  if (rows.length < 2) return NextResponse.json({ error: 'CSV needs a header row + at least one product' }, { status: 400 })

  const header = rows[0].map((h) => h.trim().toLowerCase())
  const idx = (k: string) => header.indexOf(k)
  const int = (v: string | undefined) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= 0 ? n : 0 }
  const num = (v: string | undefined) => { const n = Number(v); return Number.isFinite(n) ? n : null }
  const str = (v: string | undefined) => (v && v.trim() ? v.trim() : null)

  const records = rows.slice(1).map((r) => ({
    tenant_id: s.tenantId,
    name: str(r[idx('name')]) || 'Untitled',
    sku: str(r[idx('sku')]),
    category: str(r[idx('category')]),
    brand: str(r[idx('brand')]),
    price: num(r[idx('price')]),
    showroom_quantity: int(r[idx('showroom_quantity')]),
    warehouse_quantity: int(r[idx('warehouse_quantity')]),
    storage_quantity: int(r[idx('storage_quantity')]),
    incoming_quantity: int(r[idx('incoming_quantity')]),
    expected_arrival_date: str(r[idx('expected_arrival_date')]),
    availability_status: isAvailabilityStatus(r[idx('availability_status')]) ? r[idx('availability_status')] : 'in_stock',
    internal_notes: str(r[idx('notes')]),
  }))

  const db = createAdminClient()
  const { data, error } = await db.from('catalog_products').insert(records).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ imported: data?.length || 0 })
}
