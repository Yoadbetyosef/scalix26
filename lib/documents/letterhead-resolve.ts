import { asLetterheadStyle, DEFAULT_LETTERHEAD_STYLE, type LetterheadStyle } from './letterhead-styles'
import type { LetterheadData } from '@/components/documents/letterhead'

// Deciding WHOSE details go on a piece of stationery, and folding them over the tenant's own.
//
// Isomorphic on purpose — the Branding modal names the two designs from the same profiles this file
// reads, and it runs in the browser. Nothing here touches a database; lib/documents/doc-settings.ts
// does the reading and hands the result in.
//
// ── A PROFILE IS THE WHOLE IDENTITY, OR THERE IS NO PROFILE ─────────────────────────────────────────
//
// This started as the fold document_templates uses — override where you have a value, transparent
// where you do not — and that was WRONG, in a way that reached a customer.
//
// The T.G. Designs profile leaves `instagram` null, because the artwork prints the marks without
// usernames. Under a fold, null means "inherit", so the trade letterhead quietly picked up the RETAIL
// Instagram handle off studio_doc_settings and drew the mark. An Instagram icon on a T.G. Designs page
// pointing at TG Jewellers is not a blank field; it is a claim about a different company.
//
// So: WHEN A STYLE HAS A PROFILE, THAT PROFILE IS THE ONLY SOURCE OF ITS IDENTITY. Null means absent,
// not inherited. A design she has given its own name, domain and address must not be able to borrow
// one field from the business next door, and there is no field where borrowing is safe — an address
// is a place, a phone is a number somebody answers, a social handle is an account.
//
// The fold survives in exactly one place, and only because a style with NO profile has no identity of
// its own to speak of: 'band' falls through to the tenant record, which is where it came from before
// a second letterhead existed, and that is what keeps it working untouched for every tenant.
//
// THE COLOUR IS THE ONE EXCEPTION, deliberately. It still falls back to the document accent even in
// strict mode, because a hex is not a claim: nobody reads a colour as a business name, and the
// alternative — a letterhead that switches itself off when she clears the swatch — drops the document
// back to an unbranded layout printing the OTHER identity, which is the bug this note is about.

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

  // Its own identity, or the tenant's — never a mixture. See the note above; the mixture is what put
  // one business's Instagram mark on another business's letterhead.
  const own = <T>(fromProfile: string | null | undefined, fromTenant: T): string | T =>
    p ? (clean(fromProfile) as string | T) : (clean(fromProfile) ?? fromTenant)

  return {
    // No colour, no letterhead. A band drawn in a default black is not her stationery, and the
    // original build made the same call.
    enabled: ctx.enabled && Boolean(color),
    style,
    color: color ?? '#000000',
    businessName: own(p?.businessName, business.businessName) ?? '',
    website: own(p?.website, business.website),
    email: own(p?.email, ctx.email ?? business.email),
    phone: own(p?.phone, business.phone),
    instagram: own(p?.instagram, ctx.instagram),
    tagline: own(p?.tagline, ctx.tagline),
    address: own(p?.address, oneLineAddress(business)),
    // Already profile-only before strict mode: the tenant record has nowhere to keep them.
    tollFree: clean(p?.tollFree),
    facebook: clean(p?.facebook),
    youtube: clean(p?.youtube),
    // The strip is the TENANT's, on purpose, and is the one thing both designs share — she asked for
    // the same band of photography on each. It carries no name, no number and no address.
    stripUrl: clean(ctx.stripUrl),
  }
}

/** The label a picker shows for one design: her name for it, else the tenant's own name. */
export const letterheadName = (ctx: LetterheadContext, style: LetterheadStyle, fallback: string | null): string =>
  clean(ctx.profiles[style]?.name) ?? clean(fallback) ?? 'Your business'

/** Which design a document goes out on: the order's own choice, else her default. */
export const letterheadStyleFor = (override: string | null | undefined, ctx: LetterheadContext): LetterheadStyle =>
  override ? asLetterheadStyle(override) : ctx.defaultStyle
