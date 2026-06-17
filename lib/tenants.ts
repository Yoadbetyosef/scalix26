import type { SupabaseClient } from '@supabase/supabase-js'

const UNIQUE_VIOLATION = '23505'

// Insert a tenant, letting the DB trigger (set_tenant_slug) generate a unique slug
// from business_name (test, test-2, test-3, …). That trigger's WHILE-EXISTS loop is
// NOT race-safe: two concurrent signups with the same name can both pick `test` and
// one hits the idx_tenants_slug unique violation. So on a slug unique-violation we
// retry the insert — the trigger recomputes against the now-committed row and picks
// the next free suffix. Any other DB error returns a generic flag (never raw SQL).
export async function insertTenantWithUniqueSlug(
  supabase: SupabaseClient,
  values: Record<string, unknown>,
  retries = 5,
): Promise<{ data: { id: string; slug: string } | null; error: string | null }> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const { data, error } = await supabase.from('tenants').insert(values).select('id, slug').single()
    if (!error) return { data: data as { id: string; slug: string }, error: null }

    const slugConflict = error.code === UNIQUE_VIOLATION && /slug|idx_tenants_slug/i.test(`${error.message} ${error.details ?? ''}`)
    if (slugConflict) {
      console.warn(`[tenants] slug collision (attempt ${attempt}/${retries}) — retrying`)
      continue
    }
    // Some other DB error — log server-side, surface only a generic flag.
    console.error('[tenants] insert failed:', error.code, error.message)
    return { data: null, error: 'db' }
  }
  console.error('[tenants] slug collision: retries exhausted')
  return { data: null, error: 'db' }
}
