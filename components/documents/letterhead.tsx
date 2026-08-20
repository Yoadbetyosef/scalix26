import type { ReactNode } from 'react'

// TG's letterhead — the plum bands a customer-facing document is printed on.
//
// BUILT IN MARKUP, NOT AS A BACKGROUND IMAGE. A raster header is soft the moment it is printed, it
// carries its own idea of the page size, and it appears exactly once — so a document that runs to a
// second page loses its letterhead on every page but the first. These bands are boxes and type, so
// they are sharp at any DPI and, under @media print, they repeat on every sheet: the @page margins
// below reserve the space and the bands are fixed into it.
//
// The only artwork is the diamond glyph in the footer, and even that is drawn as an SVG path rather
// than shipped as a file.
//
// GEOMETRY, from the artwork: 1102 × 1427 at 130dpi is 8.5 × 11in. The header band is 21% of the page
// height (2.31in) and the footer 11% (1.21in), and both are reproduced proportionally on screen with
// aspect-ratio so the document looks on a monitor like the thing that comes out of the printer.

export interface LetterheadData {
  /** Off for every tenant that has not set one up — nobody inherits somebody else's stationery. */
  enabled: boolean
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
}

const PAPER = '#FCFAFA'
const HEADER_IN = 2.31   // 21% of 11in
const FOOTER_IN = 1.21   // 11% of 11in
const PAGE_SIDE_IN = 0.6

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

// https://tgjewellers.com/ → WWW.TGJEWELLERS.COM. A host that already carries a subdomain keeps it
// rather than being given a second one.
export const letterheadWebsite = (raw: string): string => {
  const host = raw.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '')
  if (!host) return ''
  return `${host.split('.').length === 2 ? 'www.' : ''}${host}`.toUpperCase()
}

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
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" aria-hidden className="shrink-0">
    <path d="M12 21 2.5 9.2 6.2 4h11.6l3.7 5.2z" />
    <path d="M2.5 9.2h19" />
    <path d="M6.2 4 8.6 9.2 12 21 15.4 9.2 17.8 4" />
  </svg>
)

export function Letterhead({ data, children }: { data: LetterheadData; children: ReactNode }) {
  if (!data.enabled) return <>{children}</>

  const { color } = data
  const hairline = `rgba(${rgbOf(color)}, 0.22)`
  // printColorAdjust, or the browser's print default of dropping backgrounds sends her letterhead out
  // as two empty rectangles.
  const band = { background: color, WebkitPrintColorAdjust: 'exact' as const, printColorAdjust: 'exact' as const }

  const contacts: Array<{ icon: ReactNode; text: string }> = []
  if (data.website) contacts.push({ icon: <GlobeIcon />, text: letterheadWebsite(data.website) })
  if (data.instagram) contacts.push({ icon: <InstagramIcon />, text: `IG @${data.instagram.replace(/^@/, '').toUpperCase()}` })
  if (data.email) contacts.push({ icon: <MailIcon />, text: data.email.toUpperCase() })
  if (data.phone) contacts.push({ icon: <PhoneIcon />, text: letterheadPhone(data.phone) })

  return (
    <div className="lh-paper mx-auto max-w-3xl" style={{ background: PAPER, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
      <style>{`
        @page { size: letter; margin: ${HEADER_IN}in ${PAGE_SIDE_IN}in ${FOOTER_IN}in; }
        @media print {
          /* Out of the flow and into the margins the @page rule just reserved, which is what makes the
             bands appear on the second sheet and the tenth as well as the first. The negative offsets
             are the margins themselves: fixed elements are laid out against the page area, and the
             letterhead has to bleed past it to the paper edge. */
          .lh-paper { max-width: none; margin: 0; }
          .lh-band { position: fixed; height: auto; aspect-ratio: auto;
                     left: -${PAGE_SIDE_IN}in; right: -${PAGE_SIDE_IN}in; }
          .lh-band-head { top: -${HEADER_IN}in; height: ${HEADER_IN}in; }
          .lh-band-foot { bottom: -${FOOTER_IN}in; height: ${FOOTER_IN}in; }
          .lh-rule { display: none; }
        }
      `}</style>

      <header className="lh-band lh-band-head flex flex-col items-center justify-center gap-4 text-white" style={{ ...band, aspectRatio: `8.5 / ${HEADER_IN}` }}>
        <div className="text-[2.05rem] font-light uppercase leading-none" style={{ letterSpacing: '0.3em', textIndent: '0.3em' }}>
          {data.businessName}
        </div>
        {contacts.length > 0 && (
          <div className="flex flex-wrap items-center justify-center">
            {contacts.map((c, i) => (
              <span key={i} className="flex items-center">
                {/* The thin vertical rules from the artwork — between the items, never on the ends. */}
                {i > 0 && <span aria-hidden className="mx-3 inline-block h-3 w-px bg-white/35" style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />}
                <span className="flex items-center gap-1.5 whitespace-nowrap text-[0.6rem] uppercase" style={{ letterSpacing: '0.14em' }}>
                  {c.icon}{c.text}
                </span>
              </span>
            ))}
          </div>
        )}
      </header>

      {/* Hairline directly under the header and directly above the footer. Print drops them: on paper
          the bands sit in the page margins and these would rule across the middle of the text. */}
      <div className="lh-rule h-px w-full" style={{ background: hairline, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />

      {children}

      <div className="lh-rule h-px w-full" style={{ background: hairline, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />

      <footer className="lh-band lh-band-foot flex items-center justify-center text-white" style={{ ...band, aspectRatio: `8.5 / ${FOOTER_IN}` }}>
        <div className="flex items-center gap-3">
          <DiamondGlyph />
          <span aria-hidden className="inline-block h-px w-8 bg-white/40" style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
          {data.tagline && (
            <span className="whitespace-nowrap text-[0.62rem] uppercase" style={{ letterSpacing: '0.22em' }}>{data.tagline}</span>
          )}
          <span aria-hidden className="inline-block h-px w-8 bg-white/40" style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
          <DiamondGlyph />
        </div>
      </footer>
    </div>
  )
}
