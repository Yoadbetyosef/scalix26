// Facebook and Instagram marks. lucide-react dropped its brand glyphs, and the connections chips were
// standing in generic ones that read as "a message" and "an at-sign" rather than as those two
// products. Inline paths rather than a second icon dependency for two rows.
//
// They inherit stroke from the chip, so they take the section hue and the white fill on press exactly
// as every lucide icon beside them does — a brand mark should not be the one glyph that ignores the
// press state.

export function FacebookGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M15 3h-2.5A3.5 3.5 0 0 0 9 6.5V9H7v3h2v9h3v-9h2.5l.5-3h-3V6.5A.5.5 0 0 1 12.5 6H15V3z" />
    </svg>
  )
}

export function InstagramGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17" cy="7" r="1.1" />
    </svg>
  )
}
