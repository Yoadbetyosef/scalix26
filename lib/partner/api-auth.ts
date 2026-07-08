import { createHash } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getPartnerContext, resolvePartnerContextForUser, type PartnerContext } from './rbac'

// Dual auth for /api/partner/*: a browser session (Supabase cookie) OR an API key
// (Authorization: Bearer pk_...). API-first — partners can drive every module programmatically.

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** Generate a new API key: returns the raw key (shown once) + the parts to store. */
export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const rand = createHash('sha256').update(`${Date.now()}:${Math.random()}:${Math.random()}`).digest('hex')
  const raw = `pk_live_${rand}`
  return { raw, prefix: raw.slice(0, 12), hash: hashApiKey(raw) }
}

/**
 * Resolve a PartnerContext from either the session or a Bearer API key. Returns null when neither
 * yields an active partner. When authed by API key, the context carries viaApiKey + scopes.
 */
export async function authenticatePartnerRequest(req: NextRequest): Promise<PartnerContext | null> {
  const auth = req.headers.get('authorization') || ''
  if (auth.startsWith('Bearer pk_')) {
    const raw = auth.slice(7).trim()
    const svc = createAdminClient()
    const { data: key } = await svc
      .from('partner_api_keys')
      .select('partner_id, scopes, revoked_at, created_by')
      .eq('key_hash', hashApiKey(raw))
      .maybeSingle()
    if (!key || key.revoked_at) return null
    // Resolve the org context off the key's partner, using the key creator as the acting user.
    const ctx = key.created_by ? await resolvePartnerContextForUser(key.created_by) : null
    const base: PartnerContext | null = ctx ?? await partnerContextForPartnerId(key.partner_id)
    if (!base || base.partnerId !== key.partner_id) return null
    svc.from('partner_api_keys').update({ last_used_at: new Date().toISOString() }).eq('key_hash', hashApiKey(raw)).then(() => {})
    return { ...base, viaApiKey: true, scopes: key.scopes || ['read'] }
  }
  return getPartnerContext()
}

/** Build a context directly from a partner id (owner seat) when no member user resolves. */
async function partnerContextForPartnerId(partnerId: string): Promise<PartnerContext | null> {
  const svc = createAdminClient()
  const { data: p } = await svc.from('partners').select('id, partner_type, status, company_name, slug, enabled_modules').eq('id', partnerId).maybeSingle()
  const { data: owner } = await svc.from('partner_members').select('user_id, role').eq('partner_id', partnerId).eq('status', 'active').order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (!p || !owner?.user_id) return null
  return { userId: owner.user_id, partnerId, partnerType: p.partner_type, role: owner.role, status: p.status, companyName: p.company_name, slug: p.slug, enabledModulesRaw: p.enabled_modules }
}

/** Standard 401 for partner API routes. */
export const partnerUnauthorized = () => NextResponse.json({ error: 'Not an active partner.' }, { status: 401 })
export const partnerForbidden = () => NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 })
