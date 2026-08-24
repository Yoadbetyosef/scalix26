import type { OrderStage } from './stages'

// One hue per board column, so thirteen stages stop reading as one wall.
//
// ANCHOR. Every value is derived from TG's plum #4E455B — hsl(264, 14%, 31%) — which is where the fan
// starts, on 'new'. From there the hue travels: indigo through the factory approvals, orchid and magenta
// through the customer approvals, then rose, clay and amber as the piece is actually made. Progress is
// the hue itself, so the board reads left to right even with the labels covered. Saturation stays
// between 16% and 42% throughout: this is a jeweller's board, not a traffic light, and deliberately
// avoids the primary blue/green/red status palette.
//
// ADJACENCY. No two neighbouring stages sit closer than 16° apart, and the pair either side of an
// approval (changes-requested → approved) jump 58°, because that transition is the one that matters.
//
// SETTLED. The three terminal stages collapse back to near-neutral — saturation under 13%, and a bar
// lighter than any live stage's — so a finished job never competes with work still in front of her.
// They keep separate hues from each other (pale plum / warm grey / cool grey) so 'completed',
// 'finished' and 'cancelled' stay tellable apart, which is the whole reason they are three stages and
// not one.
//
// Text on bg clears 4.5:1 for every stage.

export interface StageColor {
  /** 3px rule across the top of the column — the hue at full strength. */
  bar: string
  /** Header band tint. */
  bg: string
  /** Header label. */
  text: string
  /** Header band's bottom edge. */
  border: string
}

export const STAGE_COLORS: Record<OrderStage, StageColor> = {
  new:                        { bar: '#4E455B', bg: '#F2F0F4', text: '#4A4257', border: '#DDD9E2' }, // h264 s14 l31 — her plum, exactly, at the head of the board
  waiting_factory_approval:   { bar: '#6F69AB', bg: '#EFEFF6', text: '#3B3762', border: '#D6D5E7' }, // h246 s28 l54 — indigo
  factory_changes_requested:  { bar: '#364891', bg: '#EDEFF7', text: '#2C396D', border: '#D2D7EA' }, // h228 s46 l39 — deep indigo, the loudest of the factory trio
  factory_approved:           { bar: '#A27AAE', bg: '#F4EFF5', text: '#563A5F', border: '#E2D6E6' }, // h286 s24 l58 — violet, lifted
  waiting_customer_approval:  { bar: '#974E93', bg: '#F6EEF6', text: '#653462', border: '#E8D3E7' }, // h304 s32 l45 — orchid
  customer_changes_requested: { bar: '#8D346D', bg: '#F7EDF4', text: '#6D2C55', border: '#EAD2E1' }, // h322 s46 l38 — magenta, the loudest of the customer trio
  customer_approved:          { bar: '#B0788B', bg: '#F6EFF1', text: '#603946', border: '#E6D5DB' }, // h340 s26 l58 — dusty rose, lifted
  production:                 { bar: '#A14F55', bg: '#F7EEEE', text: '#673236', border: '#E9D3D4' }, // h356 s34 l47 — brick rose
  ready:                      { bar: '#985F3E', bg: '#F7F1ED', text: '#6D442C', border: '#EADBD2' }, // h22  s42 l42 — clay
  delivered:                  { bar: '#B69B54', bg: '#F7F5ED', text: '#6B5B2E', border: '#EAE3D2' }, // h44  s40 l52 — amber
  completed:                  { bar: '#B8B1C3', bg: '#F5F3F6', text: '#665B76', border: '#E5E2E9' }, // h264 s13 l73 — settled: the plum, gone pale
  finished:                   { bar: '#D3CEC5', bg: '#F6F5F3', text: '#766D5B', border: '#E9E7E2' }, // h40  s13 l80 — settled: warm grey
  cancelled:                  { bar: '#A4ADB7', bg: '#F4F5F6', text: '#5C6875', border: '#E2E5E9' }, // h212 s12 l68 — settled: cool grey
}

export const stageColor = (s: OrderStage): StageColor => STAGE_COLORS[s] ?? STAGE_COLORS.new

/**
 * The stage's hue as a single value, for the V2 components that take one.
 *
 * `.v2-stat` and `.v2-row` are both driven by a `--chan` custom property — one colour, from which
 * they derive their own tint and ink. This fan already answers that question better than a new
 * table would: thirteen hues, no two neighbours closer than 16°, the three terminal stages
 * collapsed to near-neutral, and text clearing 4.5:1 on every one. `bar` is the hue at full
 * strength, which is what a chip's ink wants; the chip mixes its own 12% ground from it.
 *
 * So the board's colour language and the table's are the same language, rather than two.
 */
export const stageHue = (s: OrderStage): string => stageColor(s).bar

// Widest label is "Waiting for Customer Approval" — 180px in Inter 600 at 12px, measured off the font
// the app actually ships rather than estimated. The header also carries 24px of padding, the count and
// the approval padlock, which is 247px in total: w-64 (256px) cleared it by nine pixels and lost that
// the moment a count reached two digits, which is why two columns were wrapping. 288px leaves the
// longest name a whole space of slack and never wraps.
export const STAGE_COLUMN_WIDTH = 'w-72'
