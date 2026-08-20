import type { SupabaseClient } from '@supabase/supabase-js'

// Which Page access token this tenant replies with — and, deliberately, nothing to fall back on.
//
// ── WHY THERE IS NO FALLBACK ────────────────────────────────────────────────────────────────────
//
// Four call sites used to end `?.access_token || process.env.META_PAGE_ACCESS_TOKEN`. That env var is
// the PLATFORM's own Page token, left over from when this product served one business. On a
// multi-tenant install the fallback means: any tenant whose channel row is missing a token replies to
// their customer from OUR Facebook page. The customer sees our name. Two of those four call sites were
// the AI answering automatically, so it would happen with nobody watching.
//
// A message that cannot be sent as the tenant must not be sent as somebody else. Null here, and the
// caller reports an undelivered message, which is the honest outcome.
//
// ── AND WHY status = 'connected' ────────────────────────────────────────────────────────────────
//
// The inbound webhook has always required it; the two send paths never did, so a channel could be
// disconnected and still reply. 'disconnected' is written in exactly two places — the tenant clicking
// Disconnect, and claimMetaPages moving a page to another agent — and both mean "not in use". Sending
// through it is precisely the case worth refusing: replying from a page you have unhooked, or from one
// that now belongs to a different agent.

export interface MetaPageChannel { token: string; metaPageId: string | null }

/**
 * The connected Meta channel this conversation should reply through, or null.
 *
 * `agentId` is the conversation's own agent. A tenant with two agents has two Pages, and the
 * conversation came in on one of them — replying through `limit(1)` of the tenant's channels is the
 * same bug as the platform fallback, one level down. Falls back to any connected channel of that type
 * only when the conversation carries no agent.
 */
export async function metaPageChannel(
  db: SupabaseClient,
  opts: { tenantId: string; type: 'instagram' | 'facebook'; agentId?: string | null },
): Promise<MetaPageChannel | null> {
  const base = () => db.from('channels')
    .select('credentials, meta_page_id')
    .eq('tenant_id', opts.tenantId)
    .eq('type', opts.type)
    .eq('status', 'connected')

  type Row = { credentials: Record<string, string> | null; meta_page_id: string | null }
  let row: Row | null = null
  if (opts.agentId) {
    const { data } = await base().eq('ai_employee_id', opts.agentId).limit(1).maybeSingle()
    row = (data as Row | null) ?? null
  }
  if (!row) {
    const { data } = await base().order('created_at', { ascending: false }).limit(1).maybeSingle()
    row = (data as Row | null) ?? null
  }

  const token = row?.credentials?.access_token
  return token ? { token, metaPageId: row?.meta_page_id ?? null } : null
}
