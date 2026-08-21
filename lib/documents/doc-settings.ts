import { createAdminClient } from '@/lib/supabase/server'
import { hexColor } from '@/lib/studio/types'
import { asLetterheadStyle, LETTERHEAD_STYLES, type LetterheadStyle } from './letterhead-styles'
import { EMPTY_LETTERHEAD_CONTEXT, type LetterheadContext, type LetterheadProfile } from './letterhead-resolve'

// Reading and writing ONE tenant's document branding row.
//
// Two routes reach this record — /api/studio/doc-settings and /api/orders/doc-settings — because the
// two modules are gated separately and a tenant running only Orders (TG jewellers) cannot pass the
// Studio gate. They must write the same columns the same way, so the write lives here rather than
// being copied into both and drifting the first time one of them gains a field.

export const EMPTY_DOC_SETTINGS = (tenantId: string) => ({
  tenant_id: tenantId, logo_url: null, accent_color: null, terms: null, validity_days: 30,
  letterhead_enabled: false, letterhead_tagline: null, letterhead_email: null, instagram_handle: null,
  letterhead_style: 'band', letterhead_strip_url: null,
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
  const withDesigns = {
    ...withLetterhead,
    // Anything unrecognised reads as the original design rather than as an error: a value nobody can
    // draw would take her documents down, and the wrong-but-drawable one is visibly wrong instead.
    letterhead_style: asLetterheadStyle(body.letterhead_style),
    letterhead_strip_url: str(body.letterhead_strip_url),
  }

  const db = createAdminClient()
  const upsert = (row: Record<string, unknown>) =>
    db.from('studio_doc_settings').upsert(row, { onConflict: 'tenant_id' }).select('*').single()

  // The columns arrived in two migrations, both run by hand, and either may be outstanding. Saving a
  // logo must still save a logo on a database that has had neither — so the write falls back one
  // generation at a time rather than failing on fields the tenant never touched.
  const first = await upsert(withDesigns)
  if (!first.error || !isMissingColumn(first.error)) return first
  const second = await upsert(withLetterhead)
  if (!second.error || !isMissingColumn(second.error)) return second
  return upsert(base)
}

// ── The second identity's own contact set ───────────────────────────────────────────────────────────

const profileRow = (r: Record<string, unknown>): LetterheadProfile => ({
  style: asLetterheadStyle(r.style),
  name: (r.name as string) ?? 'Letterhead',
  businessName: (r.business_name as string) ?? null,
  website: (r.website as string) ?? null,
  email: (r.email as string) ?? null,
  phone: (r.phone as string) ?? null,
  address: (r.address as string) ?? null,
  tagline: (r.tagline as string) ?? null,
  instagram: (r.instagram as string) ?? null,
  facebook: (r.facebook as string) ?? null,
  youtube: (r.youtube as string) ?? null,
  tollFree: (r.toll_free as string) ?? null,
  accentColor: (r.accent_color as string) ?? null,
})

/**
 * Every design this tenant has given its own identity.
 *
 * Wrapped, and empty rather than throwing when the table is not there: PostgREST errors on a missing
 * relation instead of returning nothing, so an unwrapped select would take every document page down
 * for every tenant until add_letterhead_designs.sql is applied. Empty means "fall through to the
 * tenant record", which is precisely today's behaviour.
 */
export async function readLetterheadProfiles(tenantId: string): Promise<Partial<Record<LetterheadStyle, LetterheadProfile>>> {
  try {
    const { data, error } = await createAdminClient()
      .from('letterhead_profiles').select('*').eq('tenant_id', tenantId)
    if (error) return {}
    const out: Partial<Record<LetterheadStyle, LetterheadProfile>> = {}
    for (const r of ((data as Array<Record<string, unknown>> | null) ?? [])) {
      const p = profileRow(r)
      out[p.style] = p
    }
    return out
  } catch {
    return {}
  }
}

/** Both halves of the letterhead — the switch and the choice from studio_doc_settings, the identities
 *  from letterhead_profiles — as the one thing a document needs. */
export function letterheadContextOf(
  settings: Record<string, unknown> | null,
  profiles: Partial<Record<LetterheadStyle, LetterheadProfile>>,
): LetterheadContext {
  if (!settings) return { ...EMPTY_LETTERHEAD_CONTEXT, profiles }
  return {
    enabled: settings.letterhead_enabled === true,
    defaultStyle: asLetterheadStyle(settings.letterhead_style),
    stripUrl: (settings.letterhead_strip_url as string) ?? null,
    tagline: (settings.letterhead_tagline as string) ?? null,
    email: (settings.letterhead_email as string) ?? null,
    instagram: (settings.instagram_handle as string) ?? null,
    profiles,
  }
}

/**
 * Save one design's identity. Upserts on (tenant_id, style), so Branding can edit either without
 * knowing whether a row exists yet.
 *
 * Returns { ok: false, missing: true } when the table has not been created, which the caller reports
 * as "run the migration" rather than as a save that silently did nothing.
 */
export async function writeLetterheadProfile(tenantId: string, style: string, body: Record<string, unknown>) {
  const s = asLetterheadStyle(style)
  if (!(LETTERHEAD_STYLES as readonly string[]).includes(style)) return { ok: false as const, error: 'Unknown letterhead design.' }
  const row = {
    tenant_id: tenantId, style: s,
    name: str(body.name) ?? 'Letterhead',
    business_name: str(body.business_name),
    website: str(body.website),
    email: str(body.email),
    phone: str(body.phone),
    address: str(body.address),
    tagline: str(body.tagline),
    instagram: str(body.instagram)?.replace(/^@/, '') ?? null,
    facebook: str(body.facebook)?.replace(/^@/, '') ?? null,
    youtube: str(body.youtube)?.replace(/^@/, '') ?? null,
    toll_free: str(body.toll_free),
    accent_color: hexColor(body.accent_color),
    updated_at: new Date().toISOString(),
  }
  try {
    const { error } = await createAdminClient()
      .from('letterhead_profiles').upsert(row, { onConflict: 'tenant_id,style' })
    if (error) return { ok: false as const, error: error.message, missing: /relation .* does not exist|PGRST205/i.test(`${error.code} ${error.message}`) }
    return { ok: true as const }
  } catch (e) {
    return { ok: false as const, error: (e as Error).message }
  }
}

// ── What Branding reads and writes, in one call ─────────────────────────────────────────────────────
//
// The modal edits the tenant's branding row AND, when she is filling in the second design, that
// design's own contact set. Two round trips would let one succeed and the other fail, leaving a
// letterhead selected as her default that has nobody's details on it — so both routes go through
// these, and both write the same way.

export async function readDocBranding(tenantId: string) {
  const [settings, profiles, { data: t }] = await Promise.all([
    readDocSettings(tenantId),
    readLetterheadProfiles(tenantId),
    // So the picker can label the original design with the name it actually prints, rather than with
    // the word "band".
    createAdminClient().from('tenants').select('business_name').eq('id', tenantId).maybeSingle(),
  ])
  return { settings, profiles, businessName: (t?.business_name as string) ?? null }
}

export async function writeDocBranding(tenantId: string, body: Record<string, unknown>) {
  // The identity FIRST. If it fails, the style has not yet been made her default, so she is not left
  // pointing at a blank letterhead — she sees the error with her old default still in force.
  const profile = body.profile as Record<string, unknown> | undefined
  if (profile && typeof profile === 'object') {
    const saved = await writeLetterheadProfile(tenantId, String(profile.style ?? ''), profile)
    if (!saved.ok) {
      return {
        data: null,
        error: {
          message: 'missing' in saved && saved.missing
            ? 'The second letterhead needs add_letterhead_designs.sql to be run first.'
            : saved.error ?? 'Could not save that letterhead.',
        },
      }
    }
  }
  const { data, error } = await writeDocSettings(tenantId, body)
  return { data, error }
}
