import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'

// Server-side CSV export for the Reports page. Operator-safe: resolves the ACTIVE workspace (owner
// tenant, or the client tenant a White Label partner is operating) and reads with the admin client +
// explicit tenant_id — the browser RLS client can't read a client tenant in operator mode.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = await getActiveTenantId()
  if (!tenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const days = Math.min(365, Math.max(1, parseInt(req.nextUrl.searchParams.get('days') || '30', 10) || 30))
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const { data } = await createAdminClient()
    .from('conversations')
    .select('id, channel, status, sentiment, created_at, summary, contact:contacts(name, phone)')
    .eq('tenant_id', tenantId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10000)

  const rows = (data || []) as Array<{ id: string; channel: string; status: string; sentiment?: string | null; created_at: string; summary?: string | null; contact?: { name?: string; phone?: string } | null }>
  const csv = [
    'ID,Contact,Phone,Channel,Status,Sentiment,Created At,Summary',
    ...rows.map((r) => [
      r.id, r.contact?.name || '', r.contact?.phone || '', r.channel, r.status,
      r.sentiment || '', r.created_at, `"${(r.summary || '').replace(/"/g, '""')}"`,
    ].join(',')),
  ].join('\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="report-${days}d.csv"`,
    },
  })
}
