import { createAdminClient } from '@/lib/supabase/server'
import { hexColor } from '@/lib/studio/types'

// Reading and writing ONE tenant's document branding row.
//
// Two routes reach this record — /api/studio/doc-settings and /api/orders/doc-settings — because the
// two modules are gated separately and a tenant running only Orders (TG jewellers) cannot pass the
// Studio gate. They must write the same columns the same way, so the write lives here rather than
// being copied into both and drifting the first time one of them gains a field.

export const EMPTY_DOC_SETTINGS = (tenantId: string) => ({
  tenant_id: tenantId, logo_url: null, accent_color: null, terms: null, validity_days: 30,
  letterhead_enabled: false, letterhead_tagline: null, letterhead_email: null, instagram_handle: null,
})

export async function readDocSettings(tenantId: string) {
  const db = createAdminClient()
  const { data } = await db.from('studio_doc_settings').select('*').eq('tenant_id', tenantId).maybeSingle()
  return data || EMPTY_DOC_SETTINGS(tenantId)
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

// A missing column, said by Postgres (42703) and by PostgREST's schema cache (PGRST204), which reports
// the same thing in its own words.
const isMissingColumn = (e: { code?: string; message?: string } | null): boolean =>
  e?.code === '42703' || e?.code === 'PGRST204' || /column .* does not exist/i.test(e?.message ?? '')

export async function writeDocSettings(tenantId: string, body: Record<string, unknown>) {
  const days = Math.trunc(Number(body.validity_days))
  const base = {
    tenant_id: tenantId,
    logo_url: str(body.logo_url),
    accent_color: hexColor(body.accent_color),
    terms: str(body.terms),
    validity_days: Number.isFinite(days) && days > 0 ? days : 30,
    updated_at: new Date().toISOString(),
  }
  const withLetterhead = {
    ...base,
    letterhead_enabled: body.letterhead_enabled === true,
    letterhead_tagline: str(body.letterhead_tagline),
    // Stored only when she has actually given the stationery its own address; null falls back to the
    // account email at render time, so clearing this field restores that rather than blanking the band.
    letterhead_email: str(body.letterhead_email),
    instagram_handle: str(body.instagram_handle)?.replace(/^@/, '') ?? null,
  }

  const db = createAdminClient()
  const upsert = (row: Record<string, unknown>) =>
    db.from('studio_doc_settings').upsert(row, { onConflict: 'tenant_id' }).select('*').single()

  const first = await upsert(withLetterhead)
  // The letterhead columns arrive by migration, and the migration is run by hand. Until it has been,
  // saving a logo must still save a logo rather than failing on four columns the tenant never touched.
  if (first.error && isMissingColumn(first.error)) return upsert(base)
  return first
}
