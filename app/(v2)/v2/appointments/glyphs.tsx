// The agenda's own marks, extracted the moment a SECOND surface needed two of them.
//
// Pin and Cam were defined inline in agenda.tsx, which was right while agenda.tsx was the only file
// that drew them. fix-place.tsx needs the same two on the same button, and the alternative to this
// file is either a copy that will drift or a circular import between two client components.
//
// Only the two that are shared moved. The rest stay where they are used, because extracting a glyph
// nobody else draws buys an import and nothing else.
export const Pin = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
)
export const Cam = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="6" width="14" height="12" rx="3" /><path d="m16 11 6-3.5v9L16 13z" />
  </svg>
)
