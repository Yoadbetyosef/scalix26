// WHAT THE PIECE IS, and which of the jewellery fields that makes sense of.
//
// The order form was built for a ring. Every line rendered Centre shape, Centre weight and Ring size
// whatever it was, and the one thing it could not record was what the thing actually was. Her own data
// is the argument: on both tennis necklaces the length went into Measurements and the TOTAL weight —
// 17ct and 11ct — went into Centre weight, a box meant for one stone. Nothing was lost; it was filed
// under the wrong words.
//
// ── ISOMORPHIC, AND DELIBERATELY SO ─────────────────────────────────────────────────────────────────
//
// The form (a client component) and the printed document (a server one) must agree about what a field
// is called for a given piece, or the same number gets two names on the two surfaces a customer might
// compare. So the labels live here, in a file with no imports, and both read them.
//
// ── THE TYPES ARE HER DATA. THE FIELD SETS ARE NOT. ─────────────────────────────────────────────────
//
// The list of types is an ordinary tenant option list (key `product_type`), exactly like the stone
// list: she adds, renames, reorders and retires from Settings with no deploy. What each type MEANS —
// which fields it shows and what they are called — is code, because a type she invents tomorrow has to
// do something sensible before anyone has described it. `fieldsFor` falls back to showing EVERYTHING
// under today's labels, which is the form exactly as it was. A new type is therefore never worse than
// the status quo, and the eight below are better.
//
// ── MATCHED ON THE WORDS, NOT ON AN ID ──────────────────────────────────────────────────────────────
//
// A line item stores the LABEL she picked, never a foreign key — the same rule the rest of the option
// system follows, so retiring an option can never rewrite a past order. That means the mapping from
// her words to a field set has to survive her renaming "Tennis necklace" to "Riviera", so it reads the
// words rather than requiring an exact match.

export const PRODUCT_TYPE_LIST_KEY = 'product_type'
/** Lengths for a necklace or a bracelet. Her own list, promoted — see add_order_product_types.sql. */
export const LENGTH_LIST_KEY = 'length'

export type ProductTypeKey =
  | 'ring' | 'earrings' | 'necklace' | 'tennis_necklace' | 'bracelet' | 'tennis_bracelet'
  | 'pendant' | 'band' | 'chain' | 'watch' | 'loose_stone' | 'other' | 'unspecified'

/**
 * What a tenant taking the jewellery starter gets. Ordered as a jeweller would say them.
 *
 * The last four arrived when the form was audited for being ring-shaped: a chain has a length and
 * a metal and no stone at all; a watch has a reference and a case size; a loose stone is ALL stone
 * and has no metal, no size, no setting; and "Other" is the honest name for the anklet, the cufflink
 * and the brooch until somebody describes what each needs. A tenant who already has her own list
 * is not touched — these are what a NEW list starts with, and add_tg_production_1.sql adds the four
 * to TG's list without renaming anything she typed.
 */
export const PRODUCT_TYPE_OPTIONS = [
  'Ring', 'Band', 'Earrings', 'Pendant', 'Necklace', 'Tennis necklace', 'Bracelet', 'Tennis bracelet',
  'Chain', 'Watch', 'Loose stone', 'Other',
] as const

/**
 * Her words → a field set.
 *
 * ORDER MATTERS and the reason is "earring", which contains "ring". Earrings are tested first, and a
 * comment is cheaper than the bug. Everything unrecognised is 'unspecified', which shows the whole
 * form — the honest answer for a type nobody has described yet.
 *
 * "Tennis" on its own reads as a tennis necklace, which costs nothing: the two tennis types have the
 * same field set, so the only thing that choice affects is a word in a dropdown she picked herself.
 */
export function productTypeKey(label: string | null | undefined): ProductTypeKey {
  const t = (label ?? '').toLowerCase()
  if (!t.trim()) return 'unspecified'
  const has = (re: RegExp) => re.test(t)

  if (has(/earring|ear ring|stud|hoop/)) return 'earrings'
  // Before the ring test for the same reason as earrings: a "wedding band" is a band, and a chain
  // that says "chain" is a chain before "neck" gets a look at it.
  if (has(/loose stone|loose diamond|loose gem|melee|parcel|^stone$|^diamond$/)) return 'loose_stone'
  if (has(/watch|timepiece|rolex|omega|cartier tank/)) return 'watch'
  if (has(/tennis/)) return has(/brace|bangle|cuff/) ? 'tennis_bracelet' : 'tennis_necklace'
  if (has(/pendant|charm/)) return 'pendant'
  if (has(/band/)) return 'band'
  if (has(/brace|bangle|cuff/)) return 'bracelet'
  if (has(/\bchain\b|rope chain|curb|figaro|cable chain|box chain/) && !has(/neck|necklace|pendant/)) return 'chain'
  if (has(/neck|chain|lariat|choker|collar|riviera/)) return 'necklace'
  if (has(/ring|solitaire|engagement|eternity/)) return 'ring'
  if (has(/^other|anklet|brooch|cufflink|cuff link|tie pin|tiara|body/)) return 'other'
  return 'unspecified'
}

/**
 * The type a line ACTUALLY reads as: what she picked, else what its name says.
 *
 * The fallback is a READ, never a write. Every line she has already saved predates the field, so
 * without it "Tennis necklace" would keep printing its 17ct under "Center weight" until somebody
 * opened all eighteen and re-picked. Reading the name she typed is not a claim about what she meant —
 * it is the same inference a person makes looking at the row, and she overrules it by picking.
 *
 * The NAME only. Not the description, and not the custom spec: a ring described as "to match her
 * tennis bracelet" is a ring, and a fallback that got that wrong would be worse than none.
 */
export const effectiveProductType = (line: { productType?: string | null; productName?: string | null }): ProductTypeKey =>
  line.productType?.trim() ? productTypeKey(line.productType) : productTypeKey(line.productName)

/** The jewellery fields whose presence and wording depend on what the piece is. */
export type VariableField =
  | 'centerStoneShape' | 'centerStoneCarat' | 'sideStoneShape' | 'sideStoneCaratTotal'
  | 'ringSize' | 'measurements' | 'bandWidthMm'

export interface FieldSpec {
  /** On the form, with its unit. */
  label: string
  /** On the printed document, where the value carries the unit. */
  docLabel: string
  /** A tenant option list to pick from instead of typing. Falls back to free text when she has none. */
  list?: typeof LENGTH_LIST_KEY
}

/** Absent from a type's map = the field is not offered for that piece. */
export type FieldSet = Partial<Record<VariableField, FieldSpec>>

const CENTRE: FieldSpec = { label: 'Center shape', docLabel: 'Center shape' }
const CENTRE_CT: FieldSpec = { label: 'Center weight (ct)', docLabel: 'Center weight' }
const SIDE: FieldSpec = { label: 'Side shape', docLabel: 'Side shape' }
const SIDE_CT: FieldSpec = { label: 'Side total weight (ct)', docLabel: 'Side weight (total)' }
const RING_SIZE: FieldSpec = { label: 'Ring size', docLabel: 'Ring size' }
const MEASUREMENTS: FieldSpec = { label: 'Measurements / size', docLabel: 'Measurements' }
const LENGTH: FieldSpec = { label: 'Length', docLabel: 'Length', list: LENGTH_LIST_KEY }

// ── BAND WIDTH, AND WHY IT IS NOT `measurements` ────────────────────────────────────────────────
//
// The 'band' type already re-labels `measurements` as "Width (mm)", and her data shows widths going
// in there as free text ("2.00mm") alongside stone dimensions and necklace lengths. That worked for
// a band, where width is THE measurement, and it has never worked for a ring — which has a band
// width AND stone dimensions, and only one box to put both in.
//
// So this is its own field with its own unit, offered on everything worn on a finger. `measurements`
// keeps its per-type meaning untouched; nothing is migrated out of it (see types.ts for why parsing
// it would be a guess).
const BAND_WIDTH: FieldSpec = { label: 'Band width (mm)', docLabel: 'Band width' }

// ── CENTRE WEIGHT, WHICH IS THE ONE THAT HAD TO BE RIGHT ────────────────────────────────────────────
//
// A tennis piece has no centre stone; it has a run of identical stones and one total. The choice was
// between giving tennis its own column and RE-LABELLING the column per type. Re-labelling wins, and
// not narrowly:
//
//   Her 17ct and 11ct are already in center_stone_carat. A new column means moving them — a data
//   migration on the two rows that are the whole reason for this work, and a permanent ambiguity
//   afterwards about which of two columns holds the truth for any row nobody migrated.
//
//   totalCarats() sums centre × qty + side total × qty. Leaving the number where it is keeps the
//   document's "Total stone weight" correct with no arithmetic changed.
//
//   Nothing moves. The 17ct stays in the row she typed it into, and the moment the line reads as a
//   tennis piece it is labelled "Total weight" on the form and on the document. The number stops
//   being wrong without ever being touched.
//
// The cost is honest and worth stating: the COLUMN is still called center_stone_carat while holding a
// total for four of the eight types. The name is a lie the labels tell the truth about — the reverse
// of what we had, which was an honest column name printing the wrong word at a customer.
//
// The same trick carries `measurements`, which her data already proves is three different quantities:
// stone dimensions (10X7.5X4), band width (2.00mm) and length (16''). One column, named per piece.
const TOTAL_CT: FieldSpec = { label: 'Total weight (ct)', docLabel: 'Total weight' }
const STONE_SHAPE: FieldSpec = { label: 'Stone shape', docLabel: 'Stone shape' }

const RING: FieldSet = {
  centerStoneShape: CENTRE, centerStoneCarat: CENTRE_CT,
  sideStoneShape: SIDE, sideStoneCaratTotal: SIDE_CT,
  ringSize: RING_SIZE, measurements: MEASUREMENTS, bandWidthMm: BAND_WIDTH,
}
// No centre and no sides, one run of stones and one total: tennis, and a stone-set band.
const RUN_OF_STONES: FieldSet = { centerStoneShape: STONE_SHAPE, centerStoneCarat: TOTAL_CT }

const FIELD_SETS: Record<ProductTypeKey, FieldSet> = {
  // Everything it has today, under the words it has today. The type that was already right.
  ring: RING,
  unspecified: RING,

  // A pair has two stones, so "centre" is the wrong word and the weight is for the pair. No ring size.
  earrings: {
    centerStoneShape: STONE_SHAPE,
    centerStoneCarat: { label: 'Total weight, the pair (ct)', docLabel: 'Total weight (pair)' },
    sideStoneShape: SIDE, sideStoneCaratTotal: SIDE_CT,
    measurements: { label: 'Measurements (drop / hoop)', docLabel: 'Measurements' },
  },

  // A necklace has a length, and may well have a centre stone hanging on it.
  necklace: {
    centerStoneShape: CENTRE, centerStoneCarat: CENTRE_CT,
    sideStoneShape: SIDE, sideStoneCaratTotal: SIDE_CT,
    measurements: LENGTH,
  },
  bracelet: {
    centerStoneShape: CENTRE, centerStoneCarat: CENTRE_CT,
    sideStoneShape: SIDE, sideStoneCaratTotal: SIDE_CT,
    measurements: LENGTH,
  },

  tennis_necklace: { ...RUN_OF_STONES, measurements: LENGTH },
  tennis_bracelet: { ...RUN_OF_STONES, measurements: LENGTH },

  // It hangs, so it has dimensions rather than a length, and it usually is one stone.
  pendant: {
    centerStoneShape: CENTRE, centerStoneCarat: CENTRE_CT,
    sideStoneShape: SIDE, sideStoneCaratTotal: SIDE_CT,
    measurements: { label: 'Dimensions', docLabel: 'Dimensions' },
  },

  // Worn on a finger, so it keeps its size; set all the way round, so it has no centre; and the
  // measurement that matters is how wide it is.
  // Worn on a finger, so it keeps its size and its band width. `measurements` KEEPS its "Width (mm)"
  // wording rather than being re-pointed at the new field: the rows she has already typed a width
  // into read from that column, and moving the label would leave those values under a name that no
  // longer describes them. New widths go in the numeric field; old ones stay legible where they are.
  band: {
    ...RUN_OF_STONES,
    ringSize: RING_SIZE,
    measurements: { label: 'Width (mm)', docLabel: 'Width' },
    bandWidthMm: BAND_WIDTH,
  },

  // A chain is metal and a length. No stone fields at all — they come back only if a value is
  // already sitting in one, under its plain name, like every other type.
  chain: {
    measurements: LENGTH,
  },

  // A watch is a reference number and a case size, and the stone fields (a diamond bezel does
  // exist) read as "on the piece" rather than "centre". The reference goes in Measurements — the
  // free-text column that already holds whatever a piece's one identifying dimension is.
  watch: {
    centerStoneShape: STONE_SHAPE, centerStoneCarat: TOTAL_CT,
    measurements: { label: 'Reference / case size', docLabel: 'Reference' },
  },

  // A loose stone is ALL stone: shape, weight, dimensions, certificate — and nothing worn. No ring
  // size, no side stones, no band. Metal stays offered on the shared row below the stone group and
  // simply reads empty.
  loose_stone: {
    centerStoneShape: STONE_SHAPE,
    centerStoneCarat: { label: 'Weight (ct)', docLabel: 'Weight' },
    measurements: { label: 'Dimensions (mm)', docLabel: 'Dimensions' },
  },

  // Everything, under the plain names, until somebody says what an anklet needs.
  other: RING,
}

export const fieldsFor = (key: ProductTypeKey): FieldSet => FIELD_SETS[key] ?? RING

/** For saying out loud what a line was READ as, when she has not picked a type herself. */
export const PRODUCT_TYPE_LABEL: Record<ProductTypeKey, string> = {
  ring: 'Ring', band: 'Band', earrings: 'Earrings', pendant: 'Pendant', necklace: 'Necklace',
  tennis_necklace: 'Tennis necklace', bracelet: 'Bracelet', tennis_bracelet: 'Tennis bracelet',
  chain: 'Chain', watch: 'Watch', loose_stone: 'Loose stone', other: 'Other',
  unspecified: '',
}

/**
 * How to render one field for one piece — INCLUDING the case the whole design turns on.
 *
 * A field a type does not offer is still shown when the line already holds a value in it. Hiding it
 * would make something she typed vanish from the screen while staying in the database, which is the
 * one behaviour this work is not allowed to have. It comes back under its default wording, because a
 * "Ring size" on a pair of earrings is a mistake to correct rather than a word to reinterpret.
 */
export function fieldFor(key: ProductTypeKey, field: VariableField, hasValue: boolean): FieldSpec | null {
  const spec = fieldsFor(key)[field]
  if (spec) return spec
  if (!hasValue) return null
  return RING[field] ?? null
}
