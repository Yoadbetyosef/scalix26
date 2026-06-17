import type { SupabaseClient } from '@supabase/supabase-js'

export const PAGE_IN_USE = 'This Facebook/Instagram page is already connected to another account.'
const GENERIC_ERROR = 'Could not connect the page — please try again.'

interface PageToClaim {
  type: 'facebook' | 'instagram'
  metaPageId: string
  credentials: Record<string, string>
}

// Connect Meta page(s) to an agent with page-uniqueness enforcement:
// 1. Pre-check ALL pages for a CROSS-TENANT connected row → block, mutate nothing.
// 2. SAME-tenant connected rows for the page (any agent) → move (set disconnected).
// 3. Replace this agent's own row of that type, then insert the new connected row.
// 4. A unique-violation (23505 on idx_channels_meta_page_connected) is returned as the
//    same friendly message — never raw SQL to the user.
export async function claimMetaPages(
  supabase: SupabaseClient,
  opts: { tenantId: string; agentId: string; pages: PageToClaim[] },
): Promise<{ error: string | null }> {
  const { tenantId, agentId, pages } = opts

  // 1. Cross-tenant pre-check (read-only) before any mutation.
  for (const p of pages) {
    const { data: existing } = await supabase
      .from('channels').select('tenant_id')
      .eq('meta_page_id', p.metaPageId).eq('status', 'connected')
    if ((existing || []).some((r) => r.tenant_id !== tenantId)) {
      return { error: PAGE_IN_USE }
    }
  }

  // 2–4. Claim each page.
  for (const p of pages) {
    // Move any same-tenant connected rows for this page off (different agent, etc.).
    await supabase.from('channels').update({ status: 'disconnected' })
      .eq('meta_page_id', p.metaPageId).eq('status', 'connected').eq('tenant_id', tenantId)
    // Replace this agent's own row of this type.
    await supabase.from('channels').delete().eq('ai_employee_id', agentId).eq('type', p.type)
    // Insert the new connected row; catch the unique-index violation.
    const { error } = await supabase.from('channels').insert({
      tenant_id: tenantId, ai_employee_id: agentId, type: p.type,
      meta_page_id: p.metaPageId, credentials: p.credentials, status: 'connected',
    })
    if (error) {
      if (error.code === '23505') return { error: PAGE_IN_USE }
      console.error('[meta] channel insert failed:', error.code, error.message)
      return { error: GENERIC_ERROR }
    }
  }
  return { error: null }
}
