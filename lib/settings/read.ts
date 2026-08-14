import { createAdminClient } from '@/lib/supabase/server'
import type { Tenant, Channel } from '@/types'

// The settings page's own two reads, moved here VERBATIM from app/settings/page.tsx.
//
// Seventh extraction of this kind, same reason each time: written inline in a page's render, so a
// second screen could not ask for the same rows.
//
// ── THE BODY IS UNCHANGED ───────────────────────────────────────────────────────────────────────────
//
// Two mechanical edits, both about where control flow belongs: the workspace's tenant id is a
// parameter rather than read off `ws`, and the missing-tenant case RETURNS NULL instead of calling
// redirect() — routing belongs to the page, which still decides it.

// The same types SettingsClient already takes, so the page's props are unchanged by the move.
export interface SettingsRead { tenant: Tenant; channels: Channel[] }

export async function readSettings(tenantId: string): Promise<SettingsRead | null> {
  const db = createAdminClient()
  const { data: tenant } = await db.from('tenants').select('*').eq('id', tenantId).maybeSingle()
  if (!tenant) return null

  const { data: channels } = await db.from('channels').select('*').eq('tenant_id', tenantId)

  return { tenant: tenant as Tenant, channels: (channels ?? []) as Channel[] }
}
