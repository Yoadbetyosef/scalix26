import { createAdminClient } from '@/lib/supabase/server'

// The analytics figures, moved here VERBATIM from app/analytics/page.tsx.
//
// Fifth extraction of this kind, same reason: written inline in a page's render, so a second screen
// could not ask for the same numbers.
//
// ── THE BODY IS UNCHANGED ───────────────────────────────────────────────────────────────────────────
//
// Extracted programmatically. Two mechanical edits: the admin client is created inline instead of
// closed over as `db`, and the verified tenant id is a parameter rather than read off a tenant row.
// The window, all three queries, and both derivations are byte-identical.

export interface AnalyticsRead {
  total: number
  resolved: number
  fcr: number
  avgDuration: number
  conversations: Array<{ channel: string; status: string; created_at: string; duration_seconds: number | null }>
}

export async function readAnalytics(tenantId: string): Promise<AnalyticsRead> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { count: totalConversations },
    { count: resolvedConversations },
    { data: conversations },
  ] = await Promise.all([
    createAdminClient().from('conversations').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).gte('created_at', thirtyDaysAgo),
    createAdminClient().from('conversations').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('status', 'resolved').gte('created_at', thirtyDaysAgo),
    createAdminClient().from('conversations').select('channel, status, created_at, duration_seconds')
      .eq('tenant_id', tenantId).gte('created_at', thirtyDaysAgo),
  ])

  const total = totalConversations || 0
  const resolved = resolvedConversations || 0
  const fcr = total > 0 ? Math.round((resolved / total) * 100) : 0

  const avgDuration = conversations?.length
    ? Math.round(conversations.filter(c => c.duration_seconds).reduce((a, c) => a + (c.duration_seconds || 0), 0) / conversations.length)
    : 0

  return { total, resolved, fcr, avgDuration, conversations: (conversations ?? []) as AnalyticsRead['conversations'] }
}
