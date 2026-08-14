import { FacebookGlyph, InstagramGlyph } from '../brand-glyphs'
import type { ChannelKey } from '../channels'

// THE CHANNEL TILE — one shape, one size, the channel's own glyph and hue.
//
// The hue is never written here. It comes from `--chan` in v2-tokens.css, which is the one table
// every channel mark in /v2 reads — the list row, this tile, the conversation header chip. That is
// why a thread and the row that led to it cannot disagree about what channel they are: there is
// nothing to disagree with. L1's brand hues went INTO that table rather than beside it.
//
// A channel the map does not know gets the neutral tile and the neutral glyph. Not a guessed colour:
// an unknown channel that looks like one of the five is worse than one that looks like none of them.

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

// A CALL HAD NO GLYPH OF ITS OWN. It fell through to a speech bubble — a near-twin of the SMS one —
// so voice, SMS and "a channel we do not recognise" all drew the same mark and a column of rows could
// not be sorted by eye. That is the whole complaint, and it was a missing branch, not a missing hue.
const Voice = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 16.9v2.6a1.6 1.6 0 0 1-1.8 1.6 16.3 16.3 0 0 1-7.1-2.5 16 16 0 0 1-5-5A16.3 16.3 0 0 1 4.6 6.5 1.6 1.6 0 0 1 6.2 4.7h2.6a1.6 1.6 0 0 1 1.6 1.4c.1.9.3 1.7.6 2.5a1.6 1.6 0 0 1-.4 1.7l-1.1 1.1a13 13 0 0 0 5 5l1.1-1.1a1.6 1.6 0 0 1 1.7-.4c.8.3 1.6.5 2.5.6a1.6 1.6 0 0 1 1.4 1.6z" />
  </svg>
)

const Web = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" />
  </svg>
)

/** Only for a channel the map does not know. Neutral, and deliberately not one of the six marks. */
const Unknown = () => (
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
      {channel === 'voice' ? <Voice />
        : channel === 'sms' ? <Sms />
        : channel === 'instagram' ? <InstagramGlyph />
        : channel === 'facebook' ? <FacebookGlyph />
        : channel === 'email' ? <Mail />
        : channel === 'web' ? <Web />
        : <Unknown />}
    </span>
  )
}
