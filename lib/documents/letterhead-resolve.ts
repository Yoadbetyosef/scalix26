import { asLetterheadStyle, DEFAULT_LETTERHEAD_STYLE, type LetterheadStyle } from './letterhead-styles'
import type { LetterheadData } from '@/components/documents/letterhead'

// Deciding WHOSE details go on a piece of stationery, and folding them over the tenant's own.
//
// Isomorphic on purpose — the Branding modal names the two designs from the same profiles this file
// reads, and it runs in the browser. Nothing here touches a database; lib/documents/doc-settings.ts
// does the reading and hands the result in.
//
// ── A PROFILE IS AN OVERRIDE WHERE IT HAS A VALUE, AND TRANSPARENT WHERE IT DOES NOT ────────────────
//
// The same fold document_templates already uses, and for the same reason: a design that only sets a
// name and a domain still inherits her phone number rather than printing a blank. It is also what lets
// the original design keep working with NO profile row at all — every field falls through to the
// tenant record, which is exactly where it came from before a second letterhead existed.
//
// The one thing that never falls through is the NAME. "T.G. Designs" beside "TG Jewellers" is how she
// tells two pieces of stationery apart in a picker, and inheriting the other one's name would defeat
// the picker entirely.

export interface LetterheadProfile {
  style: LetterheadStyle
  /** What the picker shows. Never inherited. */
  name: string
  businessName: string | null
  website: string | null
  email: string | null
  phone: string | null
  /** One printed line. Falls back to the tenant's address fields assembled in reading order. */
  address: string | null
  tagline: string | null
  instagram: string | null
  facebook: string | null
  youtube: string | null
  tollFree: string | null
  accentColor: string | null
}

/** The tenant's own details, as the document already knows them. Structurally the DocBusiness that
 *  lib/orders/documents.ts builds — declared here so this file imports nothing server-side. */
export interface LetterheadBusiness {
  businessName: string | null; email: string | null; phone: string | null; website: string | null
  address: string | null; city: string | null; state: string | null; zip: string | null
}

export interface LetterheadContext {
  /** The master switch. Off for every tenant that has not set stationery up. */
  enabled: boolean
  /** Her choice in Branding. One order may override it; see components/orders/document-body.tsx. */
  defaultStyle: LetterheadStyle
  /** The strip of photography above the footer, on whichever design is chosen. */
  stripUrl: string | null
  // Her document-branding row — the content the original design has always used.
  tagline: string | null
  email: string | null
  instagram: string | null
  /** One row per design she has given its own identity. Absent = fall through to the tenant record. */
  profiles: Partial<Record<LetterheadStyle, LetterheadProfile>>
}

export const EMPTY_LETTERHEAD_CONTEXT: LetterheadContext = {
  enabled: false, defaultStyle: DEFAULT_LETTERHEAD_STYLE, stripUrl: null,
  tagline: null, email: null, instagram: null, profiles: {},
}

const clean = (v: string | null | undefined): string | null => {
  const t = typeof v === 'string' ? v.trim() : ''
  return t ? t : null
}

/** "622 736 Granville street, vancouver, bc" — the tenant's address on one line, in reading order. */
export const oneLineAddress = (b: LetterheadBusiness): string | null =>
  clean([b.address, [b.city, b.state, b.zip].map((p) => clean(p)).filter(Boolean).join(' ')]
    .map((p) => clean(p)).filter(Boolean).join(', '))

/**
 * Everything the renderer needs for ONE document, on ONE design.
 *
 * `accent` is the document colour the rest of the page is already drawn in. The profile's own colour
 * wins where it has one — the two identities are not the same brand and the second is red — and the
 * document falls back to the tenant accent otherwise, which is what a design with no profile gets.
 */
export function resolveLetterhead(
  ctx: LetterheadContext,
  style: LetterheadStyle,
  business: LetterheadBusiness,
  accent: string | null,
): LetterheadData {
  const p = ctx.profiles[style]
  const color = clean(p?.accentColor) ?? accent

  return {
    // No colour, no letterhead. A band drawn in a default black is not her stationery, and the
    // original build made the same call.
    enabled: ctx.enabled && Boolean(color),
    style,
    color: color ?? '#000000',
    businessName: clean(p?.businessName) ?? business.businessName ?? '',
    website: clean(p?.website) ?? business.website,
    email: clean(p?.email) ?? ctx.email ?? business.email,
    phone: clean(p?.phone) ?? business.phone,
    instagram: clean(p?.instagram) ?? ctx.instagram,
    tagline: clean(p?.tagline) ?? ctx.tagline,
    address: clean(p?.address) ?? oneLineAddress(business),
    tollFree: clean(p?.tollFree),
    facebook: clean(p?.facebook),
    youtube: clean(p?.youtube),
    stripUrl: clean(ctx.stripUrl),
  }
}

/** The label a picker shows for one design: her name for it, else the tenant's own name. */
export const letterheadName = (ctx: LetterheadContext, style: LetterheadStyle, fallback: string | null): string =>
  clean(ctx.profiles[style]?.name) ?? clean(fallback) ?? 'Your business'

/** Which design a document goes out on: the order's own choice, else her default. */
export const letterheadStyleFor = (override: string | null | undefined, ctx: LetterheadContext): LetterheadStyle =>
  override ? asLetterheadStyle(override) : ctx.defaultStyle
