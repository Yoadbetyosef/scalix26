import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canEditPipeline, canWriteVia } from '@/lib/partner/roles'
import { logPartnerAction } from '@/lib/partner/audit'

// Minimal CSV parser (handles quoted fields + commas/newlines within quotes).
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') inQ = false
      else cell += c
    } else {
      if (c === '"') inQ = true
      else if (c === ',') { row.push(cell); cell = '' }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
      else if (c === '\r') { /* skip */ }
      else cell += c
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((v) => v.trim()))
}

const FIELD_ALIASES: Record<string, string> = {
  business: 'business_name', 'business name': 'business_name', company: 'business_name', name: 'business_name',
  contact: 'contact_name', 'contact name': 'contact_name', email: 'email', phone: 'phone',
  website: 'website', url: 'website', industry: 'industry', source: 'source', notes: 'notes',
}

export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPipeline(ctx) || !canWriteVia(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { csv } = await req.json().catch(() => ({}))
  if (!csv || typeof csv !== 'string') return NextResponse.json({ error: 'No CSV provided.' }, { status: 400 })

  const rows = parseCsv(csv)
  if (rows.length < 2) return NextResponse.json({ error: 'CSV needs a header row and at least one data row.' }, { status: 400 })
  const header = rows[0].map((h) => FIELD_ALIASES[h.trim().toLowerCase()] || h.trim().toLowerCase())
  const nameIdx = header.indexOf('business_name')
  if (nameIdx === -1) return NextResponse.json({ error: 'CSV must include a business/company name column.' }, { status: 400 })

  const leads = rows.slice(1).map((r) => {
    const rec: Record<string, unknown> = { partner_id: ctx.partnerId, assigned_to: ctx.userId, stage: 'lead', source: 'import' }
    header.forEach((h, i) => { if (['business_name', 'contact_name', 'email', 'phone', 'website', 'industry', 'source', 'notes'].includes(h) && r[i]?.trim()) rec[h] = r[i].trim() })
    return rec
  }).filter((l) => l.business_name)

  if (!leads.length) return NextResponse.json({ error: 'No valid rows found.' }, { status: 400 })
  const db = createAdminClient()
  const { error } = await db.from('crm_leads').insert(leads)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await logPartnerAction(ctx.partnerId, ctx.userId, { action: 'lead.imported', targetType: 'lead', after: { count: leads.length } })
  return NextResponse.json({ success: true, imported: leads.length })
}
