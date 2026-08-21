// The letterhead DESIGNS a tenant can choose between, and nothing else.
//
// ISOMORPHIC, like lib/modules.ts: the Branding modal is a client component and the document renderer
// is a server one, and both have to agree on what the two designs are called. A shared constant
// belongs in a file that takes no side, so there are no server imports here.
//
// A style is the drawing. The CONTENT — which business name, which contacts, which colour — comes from
// letterhead_profiles, one row per (tenant, style), because TG's two identities publish different
// domains, a different address and a toll-free number the retail side does not have.

export const LETTERHEAD_STYLES = ['band', 'rule'] as const
export type LetterheadStyle = (typeof LETTERHEAD_STYLES)[number]

/** 'band' and not null: it is the design that already exists, and a tenant's stationery must not be
 *  redrawn by a deploy. Anything unrecognised — an older row, a hand-edited value — reads as 'band'
 *  for the same reason. */
export const DEFAULT_LETTERHEAD_STYLE: LetterheadStyle = 'band'
export const asLetterheadStyle = (v: unknown): LetterheadStyle =>
  (LETTERHEAD_STYLES as readonly string[]).includes(v as string) ? (v as LetterheadStyle) : DEFAULT_LETTERHEAD_STYLE

/** Named for what the paper looks like, so the picker means something before she has clicked either. */
export const LETTERHEAD_STYLE_META: Record<LetterheadStyle, { label: string; description: string }> = {
  band: {
    label: 'Solid bands',
    description: 'Your colour across the top and bottom of every page, name and contacts reversed out in white.',
  },
  rule: {
    label: 'White paper, ruled',
    description: 'White page, serif wordmark and social icons at the left, contacts at the right behind a rule, a colour band only at the foot.',
  },
}
