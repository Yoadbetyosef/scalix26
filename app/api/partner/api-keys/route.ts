import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest, generateApiKey } from '@/lib/partner/api-auth'
import { canManageApiKeys } from '@/lib/partner/rbac'
import { logPartnerAction } from '@/lib/partner/audit'

export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()
  const { data } = await db.from('partner_api_keys')
    .select('id, name, key_prefix, scopes, last_used_at, revoked_at, created_at')
    .eq('partner_id', ctx.partnerId).order('created_at', { ascending: false })
  return NextResponse.json({ keys: data || [] })
}

export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManageApiKeys(ctx)) return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 })
  const { name, scopes } = await req.json()
  const validScopes = (Array.isArray(scopes) ? scopes : ['read']).filter((s: string) => ['read', 'write'].includes(s))
  const { raw, prefix, hash } = generateApiKey()
  const db = createAdminClient()
  const { error } = await db.from('partner_api_keys').insert({
    partner_id: ctx.partnerId, name: name || 'API key', key_prefix: prefix, key_hash: hash,
    scopes: validScopes.length ? validScopes : ['read'], created_by: ctx.userId,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await logPartnerAction(ctx.partnerId, ctx.userId, { action: 'api_key.created', targetType: 'api_key', after: { name, scopes: validScopes } })
  // The raw key is shown exactly once.
  return NextResponse.json({ success: true, key: raw, prefix })
}

export async function DELETE(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManageApiKeys(ctx)) return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = createAdminClient()
  const { error } = await db.from('partner_api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('partner_id', ctx.partnerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await logPartnerAction(ctx.partnerId, ctx.userId, { action: 'api_key.revoked', targetType: 'api_key', targetId: id })
  return NextResponse.json({ success: true })
}
