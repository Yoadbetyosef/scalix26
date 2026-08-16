import type { RudiSegment } from '../rudi-line'

// The opening line. Same rule as every other in /v2: every clause is a figure that exists, a zero
// clause is omitted rather than padded, and the accent is the CONCLUSION — the thing to act on.
//
// Money owed is the conclusion here. Not what was sent, not what came in: the number that decides
// whether the owner has anything to do today.

export interface InvoicesLineInput {
  outstandingCents: number
  outstandingCount: number
  draftCount: number
  paidCount: number
}

const dollars = (c: number) => `$${Math.round(c / 100).toLocaleString()}`
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export function invoicesLine({ outstandingCents, outstandingCount, draftCount, paidCount }: InvoicesLineInput): RudiSegment[] {
  const segs: RudiSegment[] = []

  if (draftCount > 0) {
    segs.push({ text: `${draftCount} ${plural(draftCount, 'draft', 'drafts')} not issued. ` })
  }

  if (outstandingCount > 0) {
    segs.push({
      text: `${dollars(outstandingCents)} owed across ${outstandingCount} ${plural(outstandingCount, 'invoice', 'invoices')}.`,
      accent: true,
    })
    return segs
  }

  if (paidCount > 0) {
    segs.push({ text: 'Everything issued has been paid.', accent: true })
    return segs
  }
  if (draftCount > 0) {
    segs.push({ text: 'Nothing has been issued yet.', accent: true })
    return segs
  }
  return [{ text: 'No invoices yet.', accent: true }]
}
