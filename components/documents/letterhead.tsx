import type { ReactNode } from 'react'
import { DEFAULT_LETTERHEAD_STYLE, type LetterheadStyle } from '@/lib/documents/letterhead-styles'

// The stationery a customer-facing document is printed on.
//
// BUILT IN MARKUP, NOT AS A BACKGROUND IMAGE. A raster header is soft the moment it is printed, it
// carries its own idea of the page size, and it appears exactly once — so a document that runs to a
// second page loses its letterhead on every page but the first. These bands are boxes and type, so
// they are sharp at any DPI and they repeat on every sheet.
//
// A TABLE, AND NOT AN ARBITRARY ONE. Repeating a printed header is the one job thead was invented for,
// and browsers have done it for twenty years. The obvious modern answer — position:fixed bands dropped
// into reserved @page margins — was tried first and measured: Chrome printed the header on pages one
// and two of a three-page quote and not on the third, and doubled the footer on two of them. thead and
// tfoot were then measured the same way and put both bands on every sheet. The wrapper is a table
// because that is what makes the letterhead true on page ten; the document inside it is untouched.
//
// ── TWO DESIGNS ─────────────────────────────────────────────────────────────────────────────────────
//
//   'band'  the original. Solid colour top and bottom, wordmark reversed out in white, contacts on
//           the band, two diamonds around a tagline at the foot. Unchanged by the arrival of the
//           second — a tenant's stationery must not be redrawn by a deploy.
//   'rule'  white paper. A serif wordmark with a diamond set into it and a row of social marks at the
//           left, four contact rows at the right behind a vertical rule, the header closed by a
//           full-width hairline, and a full-bleed colour band only at the foot.
//
// Which one, and WHOSE CONTACTS, are decided before this component: see lib/documents/doc-settings.ts.
// The two identities on a 'rule' page are not the same business as the 'band' page — different domain,
// different address, a toll-free number the other does not publish — so nothing here reaches for a
// tenant record. It prints what it is handed.
//
// The only artwork drawn here is the two diamonds, as SVG paths rather than shipped files. The one
// raster is the strip of photography above the footer, which is a photograph and could not be
// anything else.
//
// GEOMETRY, measured off her artwork: both files are 1102 × 1427, which at 130dpi is 8.5 × 11in.
//   band   header 21% of the page height (2.31in), footer 11% (1.21in)
//   rule   header to the closing hairline 23.8% (2.61in); footer hairline at 93.1%, band from 94.9%
//          to the paper's edge (0.56in)
// Reproduced proportionally on screen with aspect-ratio, so the document looks on a monitor like the
// thing that comes out of the printer.

export interface LetterheadData {
  /** Off for every tenant that has not set one up — nobody inherits somebody else's stationery. */
  enabled: boolean
  /** Absent on a caller that predates the second design, and 'band' is what that caller drew. */
  style?: LetterheadStyle
  /** The band colour. The tenant's document accent, so it is changed in Branding, not in a deploy. */
  color: string
  /** The wordmark. */
  businessName: string
  website: string | null
  instagram: string | null
  email: string | null
  phone: string | null
  /** The footer line between the two diamonds. */
  tagline: string | null
  // ── 'rule' only. Optional, so every existing caller compiles and draws exactly what it drew. ──────
  /** One line, as the artwork prints it: "#622-736 Granville, Vancouver, BC V6Z 1G3, Canada". */
  address?: string | null
  /** Its own line, in the accent colour, under the four contact rows. */
  tollFree?: string | null
  facebook?: string | null
  youtube?: string | null
  /**
   * The band of jewellery photography above the footer. Drawn on BOTH designs.
   *
   * A URL rather than a bundled asset so she can replace it without a deploy — which matters, because
   * the strip she supplied is 482px wide and that is 57dpi across a sheet of letter paper.
   */
  stripUrl?: string | null
}

const PAPER = '#FCFAFA'
const HEADER_IN = 2.31   // 21% of 11in
const FOOTER_IN = 1.21   // 11% of 11in
const PAGE_SIDE_IN = 0.6

// The 'rule' design, off the second artwork.
const RULE_HEADER_IN = 2.61   // 23.8% — the full-width hairline that closes the header
const RULE_FOOT_BAND_IN = 0.56
const RULE_FOOT_GAP_IN = 0.19 // white between the hairline and the band
const RULE_SIDE_PC = 5.6      // 62px of 1102 — the wordmark's own left inset

// THE STRIP, AND WHY THE BODY IS GIVEN A HEIGHT.
//
// 482 × 91 is 5.3:1, so full-bleed across 8.5in it is 1.6in tall. It must print on the LAST page only
// — a photograph repeated at the foot of every sheet of a five-page quote is wallpaper — which rules
// out tfoot, whose whole purpose is to repeat. So it is the final row of tbody instead, and it lands
// after the last line of the document by construction.
//
// On a short invoice that would leave it floating under two lines of text in the middle of the page.
// A height on the body cell fixes that: `height` on a td is a MINIMUM, so a short document's body
// grows to fill the sheet and pushes the strip down to sit above the footer, while a long one ignores
// it entirely and the strip follows the content on whatever page the content ends.
//
// SLACK is deliberate. If header + body + strip + footer came to more than 11in, a one-page invoice
// would break onto a second, almost-empty page — a far worse failure than the strip sitting an eighth
// of an inch high. So the reserved body height is a sixth of an inch short of exact.
const STRIP_IN = 8.5 / (482 / 91)
const STRIP_GAP_IN = 0.25     // never let a photograph touch the last line of the document
const STRIP_SLACK_IN = 0.15
const bodyHeightIn = (headerIn: number, footerIn: number): number =>
  Math.max(1, 11 - headerIn - footerIn - STRIP_IN - STRIP_GAP_IN - STRIP_SLACK_IN)

// #4E455B → "78, 69, 91", so the hairlines can be the band colour at a whisper rather than a grey that
// belongs to no brand.
const rgbOf = (hex: string): string => {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full.slice(0, 6), 16)
  return Number.isNaN(n) ? '0, 0, 0' : `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

// 6044468438 → 604.446.8438. Anything that is not a plain North American number is printed as she
// typed it: a phone number invented by a formatter is worse than an unformatted one.
export const letterheadPhone = (raw: string): string => {
  const d = raw.replace(/\D/g, '')
  const n = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  return n.length === 10 ? `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6)}` : raw.trim()
}

/**
 * The same number for the 'rule' design, which prints "+1.604.683.5633" — country code and all.
 *
 * A number that ALREADY carries punctuation was typed to be read that way and is left alone;
 * letterheadPhone would strip the +1 off it, which is a different number to anybody dialling from
 * outside Canada. Ten bare digits still get the dots.
 */
export const letterheadPhoneAsGiven = (raw: string): string =>
  /[+().\-\s]/.test(raw.trim()) ? raw.trim() : letterheadPhone(raw)

// https://tgjewellers.com/ → www.tgjewellers.com. A host that already carries a subdomain keeps it
// rather than being given a second one.
export const letterheadHost = (raw: string): string => {
  const host = raw.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '')
  if (!host) return ''
  return `${host.split('.').length === 2 ? 'www.' : ''}${host}`
}
/** The band design sets its contact row in caps. The rule design prints the host as it reads. */
export const letterheadWebsite = (raw: string): string => letterheadHost(raw).toUpperCase()

const iconProps = {
  width: 11, height: 11, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  'aria-hidden': true, className: 'shrink-0',
}

// Drawn here rather than imported: lucide dropped its brand glyphs, and a row where three icons come
// from one hand and the fourth from another shows it at this size.
const GlobeIcon = () => (
  <svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" /></svg>
)
const InstagramIcon = () => (
  <svg {...iconProps}><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><path d="M17.2 6.8h.01" /></svg>
)
const MailIcon = () => (
  <svg {...iconProps}><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
)
const PhoneIcon = () => (
  <svg {...iconProps}><path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17.5 17.5 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3z" /></svg>
)

// A brilliant cut seen face on: girdle, table, and the four crown facets that make it read as a stone
// rather than a lozenge.
const DiamondGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" aria-hidden className="shrink-0">
    <path d="M12 21 2.5 9.2 6.2 4h11.6l3.7 5.2z" />
    <path d="M2.5 9.2h19" />
    <path d="M6.2 4 8.6 9.2 12 21 15.4 9.2 17.8 4" />
  </svg>
)

// ── The 'rule' design's own glyphs ──────────────────────────────────────────────────────────────────

// The stone set into the wordmark, which is a WIDE brilliant rather than the compact one in the band
// footer — 115 × 60 in the artwork. Its own viewBox rather than a stretched copy of the other, because
// scaling a square glyph to 2:1 thins its horizontals and thickens nothing, and at this size that reads
// as a mistake rather than as a second stone.
const WideDiamondGlyph = ({ style }: { style?: React.CSSProperties }) => (
  <svg viewBox="0 0 48 27" fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" aria-hidden style={style}>
    <path d="M4 9 12.5 2.2h23L44 9 24 25.6z" />
    <path d="M4 9h40" />
    <path d="M12.5 2.2 16.6 9 24 25.6 31.4 9l4.1-6.8" />
    <path d="M16.6 9h14.8" />
  </svg>
)

const ruleIcon = {
  width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}
const LinkIcon = () => (
  <svg {...ruleIcon}><path d="M10 13.5a4 4 0 0 0 5.7.4l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.3 1.3" /><path d="M14 10.5a4 4 0 0 0-5.7-.4l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.3" /></svg>
)
const PinIcon = () => (
  <svg {...ruleIcon}><path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" /></svg>
)

// The social marks, in THEIR colours and not the tenant's — a Facebook glyph tinted plum is not the
// Facebook mark, and the artwork prints all three at full brand strength against white paper.
// 43px across in the artwork, which on 8.5in of paper is a third of an inch.
const SOCIAL_SIZE = 32
const socialBox = { width: SOCIAL_SIZE, height: SOCIAL_SIZE, viewBox: '0 0 32 32', 'aria-hidden': true as const }
const FacebookMark = ({ ink }: { ink: React.CSSProperties }) => (
  <svg {...socialBox} style={ink}>
    <circle cx="16" cy="16" r="16" fill="#1877F2" />
    <path fill="#fff" d="M21 10.6h-2.3c-.5 0-.9.4-.9 1v2h3.1l-.4 3.2h-2.7V25h-3.3v-8.2H12v-3.2h2.5v-2.3c0-2.3 1.6-3.9 3.9-3.9H21z" />
  </svg>
)
const InstagramMark = ({ ink }: { ink: React.CSSProperties }) => (
  <svg {...socialBox} style={ink}>
    <defs>
      <linearGradient id="lh-ig" x1="0" y1="32" x2="32" y2="0">
        <stop offset="0" stopColor="#FDCB5C" /><stop offset="0.35" stopColor="#E95950" />
        <stop offset="0.7" stopColor="#C837AB" /><stop offset="1" stopColor="#4C68D7" />
      </linearGradient>
    </defs>
    <circle cx="16" cy="16" r="16" fill="url(#lh-ig)" />
    <rect x="9" y="9" width="14" height="14" rx="4.4" fill="none" stroke="#fff" strokeWidth="1.9" />
    <circle cx="16" cy="16" r="3.5" fill="none" stroke="#fff" strokeWidth="1.9" />
    <circle cx="20.4" cy="11.6" r="1.05" fill="#fff" />
  </svg>
)
const YoutubeMark = ({ ink }: { ink: React.CSSProperties }) => (
  <svg {...socialBox} style={ink}>
    <circle cx="16" cy="16" r="16" fill="#FF0000" />
    <path fill="#fff" d="M24 12.6a2.2 2.2 0 0 0-1.5-1.6C21.1 10.6 16 10.6 16 10.6s-5.1 0-6.5.4A2.2 2.2 0 0 0 8 12.6 23 23 0 0 0 7.6 16 23 23 0 0 0 8 19.4 2.2 2.2 0 0 0 9.5 21c1.4.4 6.5.4 6.5.4s5.1 0 6.5-.4a2.2 2.2 0 0 0 1.5-1.6 23 23 0 0 0 .4-3.4 23 23 0 0 0-.4-3.4zM14.4 19v-6l5.2 3z" />
  </svg>
)

export function Letterhead({ data, children }: { data: LetterheadData; children: ReactNode }) {
  if (!data.enabled) return <>{children}</>

  const style = data.style ?? DEFAULT_LETTERHEAD_STYLE
  const { color } = data
  const hairline = `rgba(${rgbOf(color)}, 0.22)`
  // printColorAdjust, or the browser's print default of dropping backgrounds sends her letterhead out
  // as two empty rectangles.
  const ink = { WebkitPrintColorAdjust: 'exact' as const, printColorAdjust: 'exact' as const }
  const band = { background: color, ...ink }
  const strip = data.stripUrl ? data.stripUrl.trim() : ''

  const isRule = style === 'rule'
  const headerIn = isRule ? RULE_HEADER_IN : HEADER_IN
  const footerIn = isRule ? RULE_FOOT_GAP_IN + RULE_FOOT_BAND_IN : FOOTER_IN
  const bodyIn = bodyHeightIn(headerIn, footerIn)

  const contacts: Array<{ icon: ReactNode; text: string }> = []
  if (data.website) contacts.push({ icon: <GlobeIcon />, text: letterheadWebsite(data.website) })
  if (data.instagram) contacts.push({ icon: <InstagramIcon />, text: `IG @${data.instagram.replace(/^@/, '').toUpperCase()}` })
  if (data.email) contacts.push({ icon: <MailIcon />, text: data.email.toUpperCase() })
  if (data.phone) contacts.push({ icon: <PhoneIcon />, text: letterheadPhone(data.phone) })

  // The right-hand column of the rule design, in the artwork's order: the number you call, the address
  // you write to, the site, then where the shop is. A contact she has not given is left out rather than
  // printed as an empty row.
  const ruleRows: Array<{ icon: ReactNode; text: string }> = []
  if (data.phone) ruleRows.push({ icon: <PhoneIcon />, text: letterheadPhoneAsGiven(data.phone) })
  if (data.email) ruleRows.push({ icon: <MailIcon />, text: data.email })
  if (data.website) ruleRows.push({ icon: <LinkIcon />, text: letterheadHost(data.website) })
  if (data.address) ruleRows.push({ icon: <PinIcon />, text: data.address })

  // "T.G. DESIGNS" → "T.G." · stone · "DESIGNS". The stone goes into the gap the wordmark already has,
  // so a one-word name simply gets it at the end rather than being split somewhere it does not divide.
  const nameParts = data.businessName.trim().split(/\s+/)
  const nameHead = nameParts[0] ?? ''
  const nameTail = nameParts.slice(1).join(' ')

  return (
    <table className="lh-paper mx-auto w-full max-w-3xl border-separate" style={{ background: isRule ? '#FFFFFF' : PAPER, borderSpacing: 0, ...ink }}>
      <style>{`
        /* On screen the bands hold the artwork's proportions at whatever width the document is shown
           at; on paper they are the measurement itself. Set here rather than inline because an inline
           aspect-ratio would outrank the print rule that has to replace it. */
        .lh-band-inner-head { aspect-ratio: 8.5 / ${HEADER_IN}; }
        .lh-band-inner-foot { aspect-ratio: 8.5 / ${FOOTER_IN}; }
        /* min-height and not height, unlike the band above: this header is a column of text rather
           than one centred line, and a long address must push the hairline down rather than run out
           through it. */
        .lh-rule-head { aspect-ratio: 8.5 / ${RULE_HEADER_IN}; }
        .lh-rule-foot { aspect-ratio: 8.5 / ${RULE_FOOT_BAND_IN}; }
        .lh-rule-gap  { aspect-ratio: 8.5 / ${RULE_FOOT_GAP_IN}; }
        .lh-strip img { display: block; width: 100%; height: auto; }
        /* No page margin: the bands run to the paper's edge, and the body cell carries the inset
           instead — a margin would leave a white frame around a letterhead that is meant to bleed. */
        @page { size: letter; margin: 0; }
        @media print {
          .lh-paper { max-width: none; width: 100%; margin: 0; }
          .lh-band-inner-head { aspect-ratio: auto; height: ${HEADER_IN}in; }
          .lh-band-inner-foot { aspect-ratio: auto; height: ${FOOTER_IN}in; }
          .lh-rule-head { aspect-ratio: auto; min-height: ${RULE_HEADER_IN}in; }
          .lh-rule-foot { aspect-ratio: auto; height: ${RULE_FOOT_BAND_IN}in; }
          .lh-rule-gap  { aspect-ratio: auto; height: ${RULE_FOOT_GAP_IN}in; }
          .lh-body { padding-left: ${PAGE_SIDE_IN}in; padding-right: ${PAGE_SIDE_IN}in; }
          ${strip ? `.lh-body { height: ${bodyIn.toFixed(2)}in; }` : ''}
        }
      `}</style>

      {/* thead, so it prints again at the top of every sheet. */}
      <thead>
        <tr><td className="p-0">
          {isRule ? (
            /* The right inset is wider than the left, which is what makes the address break after
               "Vancouver," the way the artwork breaks it. */
            <div className="lh-rule-head flex items-start justify-between gap-6" style={{ padding: `5.2% 10% 2.5% ${RULE_SIDE_PC}%`, ...ink }}>
              <div className="flex shrink-0 flex-col items-start">
                <div
                  className="font-serif leading-[0.95]"
                  style={{
                    color,
                    // vw, because in print the viewport IS the page: 8.2% of 8.5in is the 90px the
                    // wordmark measures in the artwork. The clamp is for the screen, where the viewport
                    // is a window rather than a sheet of paper and the document is only 48rem of it.
                    fontSize: 'clamp(2.2rem, 8.2vw, 4.2rem)',
                    letterSpacing: '0.02em',
                  }}
                >
                  <span className="whitespace-nowrap">
                    {nameHead}
                    <WideDiamondGlyph style={{ display: 'inline-block', width: '1.3em', height: '0.72em', marginLeft: '0.06em', verticalAlign: '0.06em' }} />
                  </span>
                  {nameTail && <div className="whitespace-nowrap">{nameTail}</div>}
                </div>
                {(data.facebook || data.instagram || data.youtube) && (
                  <div className="mt-6 flex items-center gap-3 self-center">
                    {data.facebook && <FacebookMark ink={ink} />}
                    {data.instagram && <InstagramMark ink={ink} />}
                    {data.youtube && <YoutubeMark ink={ink} />}
                  </div>
                )}
              </div>

              {/* The thin vertical rule from the artwork, at 41% of the page. Its own element rather
                  than a border on the column beside it, so it keeps the artwork's inset from the type
                  on both sides. */}
              <div aria-hidden className="w-px self-stretch" style={{ background: color, opacity: 0.85, ...ink }} />

              <div className="min-w-0 flex-1 pt-1">
                {ruleRows.map((r, i) => (
                  <div key={i} className="mb-2 flex items-start gap-3 last:mb-0">
                    <span className="mt-0.5 shrink-0" style={{ color, ...ink }}>{r.icon}</span>
                    <span className="leading-snug text-neutral-900" style={{ fontSize: 'clamp(0.8rem, 2.35vw, 1.2rem)' }}>{r.text}</span>
                  </div>
                ))}
                {data.tollFree && (
                  <div className="mt-2 leading-snug" style={{ color, fontSize: 'clamp(0.8rem, 2.35vw, 1.2rem)', ...ink }}>
                    Toll-free number&nbsp;&nbsp;{data.tollFree}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="lh-band-inner-head flex flex-col items-center justify-center gap-4 text-white" style={band}>
              <div className="text-[2.05rem] font-light uppercase leading-none" style={{ letterSpacing: '0.3em', textIndent: '0.3em' }}>
                {data.businessName}
              </div>
              {contacts.length > 0 && (
                <div className="flex flex-wrap items-center justify-center">
                  {contacts.map((c, i) => (
                    <span key={i} className="flex items-center">
                      {/* The thin vertical rules from the artwork — between the items, never on the ends. */}
                      {i > 0 && <span aria-hidden className="mx-3 inline-block h-3 w-px bg-white/35" style={ink} />}
                      <span className="flex items-center gap-1.5 whitespace-nowrap text-[0.6rem] uppercase" style={{ letterSpacing: '0.14em' }}>
                        {c.icon}{c.text}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* The hairline directly under the header, and its twin above the footer. On the rule design
              it is the full-strength red the artwork closes its header with, not a whisper of it. */}
          <div className="h-px w-full" style={{ background: isRule ? color : hairline, ...ink }} />
        </td></tr>
      </thead>

      <tbody>
        <tr><td className="lh-body p-0 align-top">{children}</td></tr>
        {strip && (
          <tr><td className="lh-strip p-0 align-bottom" style={{ paddingTop: `${STRIP_GAP_IN}in` }}>
            {/* break-inside-avoid so the strip is never cut in half by a page boundary; it moves whole
                to the next sheet instead. */}
            <div className="break-inside-avoid">
              {/* eslint-disable-next-line @next/next/no-img-element -- tenant artwork by URL, not a static import */}
              <img src={strip} alt="" aria-hidden />
            </div>
          </td></tr>
        )}
      </tbody>

      <tfoot>
        <tr><td className="p-0">
          {isRule ? (
            <>
              <div className="h-px w-full" style={{ background: color, ...ink }} />
              <div className="lh-rule-gap w-full" />
              <div className="lh-rule-foot w-full" style={band} />
            </>
          ) : (
            <>
              <div className="h-px w-full" style={{ background: hairline, ...ink }} />
              <div className="lh-band-inner-foot flex items-center justify-center text-white" style={band}>
                <div className="flex items-center gap-3">
                  <DiamondGlyph />
                  <span aria-hidden className="inline-block h-px w-8 bg-white/40" style={ink} />
                  {data.tagline && (
                    <span className="whitespace-nowrap text-[0.62rem] uppercase" style={{ letterSpacing: '0.22em' }}>{data.tagline}</span>
                  )}
                  <span aria-hidden className="inline-block h-px w-8 bg-white/40" style={ink} />
                  <DiamondGlyph />
                </div>
              </div>
            </>
          )}
        </td></tr>
      </tfoot>
    </table>
  )
}
