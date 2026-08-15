import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { enabledModulesOf, effectiveModules } from '@/lib/modules'
import { getModuleFlags } from '@/lib/admin/module-flags'

// The four lines every v2 list page repeats: session, tenant, and the module gate /dashboard applies.
// Extracted after the second copy rather than the fifth — the gate is the part that must not drift,
// because a page that forgets it shows a tenant a module they do not have.

// Re-exported so every existing server-side caller is unchanged. The declaration moved to
// ./preview.ts, which a client component can import — see the note there.
export { PREVIEW } from './preview'

export async function listPageContext(required?: string): Promise<{ tenantId: string; modules: string[] }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/dashboard')

  const { data: tenant } = await createAdminClient().from('tenants').select('*').eq('id', tenantId).maybeSingle()
  if (!tenant) redirect('/dashboard')
  const isEnterprise = Array.isArray((tenant as { tags?: string[] }).tags) && (tenant as { tags?: string[] }).tags!.includes('Enterprise')
  const modules: string[] = effectiveModules(enabledModulesOf(tenant), await getModuleFlags(), isEnterprise)
  // Same fallback shape as /dashboard, where a disabled tab silently becomes Overview.
  if (required && !modules.includes(required)) redirect('/v2')

  return { tenantId, modules }
}

/** Shared by every list page: "4 hr ago", on the table's own thresholds. */
export function relativeTime(iso: string): string {
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60) return 'Just now'
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)} hr ago`
  return `${Math.floor(sec / 86400)} d ago`
}
