// The reference's own symbols, inlined. Same set, same stroke weights.
export const Bank = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 10h18M5 10v8M19 10v8M9 10v8M15 10v8M2 21h20M12 3 3 8h18z" />
  </svg>
)
export const Cash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="6" width="20" height="12" rx="3" /><circle cx="12" cy="12" r="2.5" />
  </svg>
)
export const Card = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="5" width="20" height="14" rx="3" /><path d="M2 10h20" />
  </svg>
)
export const Doc = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M14 3v5h5" /><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2z" />
  </svg>
)
export const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m20 6-11 11-5-5" />
  </svg>
)
export const Plus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

/** The glyph for a recorded payment's method. `other` and an unrecorded method both take the doc. */
export const MethodGlyph = ({ method }: { method: string | null }) =>
  method === 'cash' ? <Cash /> : method === 'card' ? <Card /> : method === 'transfer' || method === 'zelle' ? <Bank /> : <Doc />

/** The words, so a row never shows a raw enum. */
export const METHOD_LABEL: Record<string, string> = {
  transfer: 'Bank transfer', zelle: 'Zelle', cash: 'Cash', cheque: 'Cheque', card: 'Card', other: 'Other',
}
