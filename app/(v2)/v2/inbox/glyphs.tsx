import { FacebookGlyph, InstagramGlyph } from '../brand-glyphs'
import type { ChannelKey } from '../channels'

// THE CHANNEL TILE — one shape, one size, the channel's own hue.
//
// The mockup draws Instagram in #E1306C and Messenger in #1877F2, the two brands' own colours. This
// uses `--chan` from v2-tokens.css instead, and that is a deliberate departure from taking the
// mockup's values: DESIGN.md's standing rule is that channel colour comes from ONE table, everywhere
// a channel appears. A second set of hues here would mean the same Instagram thread is pink in the
// list and crimson on this screen. Shape, size and radius are the mockup's exactly.

const Sms = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z" />
  </svg>
)

const Mail = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="m3.5 7 8.5 6 8.5-6" />
  </svg>
)

const Speech = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
  </svg>
)

/**
 * The brand glyphs are stroked shapes that inherit `currentColor`, which the tile sets from `--chan`.
 * An unknown channel still gets a tile — a row with a hole where every other row has an icon reads as
 * a rendering fault rather than as a channel we have no mark for.
 */
export function ChannelGlyph({ channel }: { channel: ChannelKey | null }) {
  return (
    <span className="v2-mav" data-channel={channel ?? undefined} aria-hidden>
      {channel === 'instagram' ? <InstagramGlyph />
        : channel === 'facebook' ? <FacebookGlyph />
        : channel === 'email' ? <Mail />
        : channel === 'sms' ? <Sms />
        : <Speech />}
    </span>
  )
}
