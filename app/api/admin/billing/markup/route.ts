import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAdminContext, canWrite } from '@/lib/admin/rbac'
import { DEFAULT_MARKUP_PCT } from '@/lib/billing/pricing'

// Admin markup configuration. GET returns the active global markup + any per-partner overrides.
// PUT sets a NEW active global markup (versioned: the previous active row is deactivated, never
// deleted — so effective_from history is preserved). Per-partner overrides are read-only here for
// now (the future editor writes scope='partner' rows through the same table).

export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createAdminClient()

  const { data: rows } = await db.from('billing_markup_config')
    .select('scope, partner_id, markup_pct, currency, effective_from')
    .eq('active', true)
  const global = (rows || []).find((r) => r.scope === 'global' && r.currency === 'usd')
  const overrides = (rows || []).filter((r) => r.scope !== 'global')

  return NextResponse.json({
    globalMarkupPct: global ? Number(global.markup_pct) : DEFAULT_MARKUP_PCT,
    usingFallback: !global,
    overrides,
  })
}

export async function PUT(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!canWrite(ctx.role)) return NextResponse.json({ error: 'Read-only role' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const pct = Number(body.markup_pct)
  if (!Number.isFinite(pct) || pct < 0 || pct > 1000) {
    return NextResponse.json({ error: 'markup_pct must be a number between 0 and 1000' }, { status: 400 })
  }

  const db = createAdminClient()
  // Deactivate the current active global (preserves history), then insert the new active row.
  await db.from('billing_markup_config').update({ active: false })
    .eq('scope', 'global').eq('currency', 'usd').eq('active', true)
  const { error } = await db.from('billing_markup_config').insert({
    scope: 'global', markup_pct: pct, currency: 'usd', active: true, updated_by: ctx.email,
  })
  if (error) return NextResponse.json({ error: 'Failed to save markup' }, { status: 500 })

  return NextResponse.json({ ok: true, globalMarkupPct: pct })
}
