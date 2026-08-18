import type { InvoiceLine } from '@/lib/invoices/types'

// THE THREE GROUPS ON THE REVIEW SCREEN, in the order the work happens in.
//
//   NEEDS A MATCH   — nothing will happen to these until a person decides. They block the gate.
//   COST WILL MOVE  — matched, and applying would move the product's cost enough to matter.
//   MATCHED CLEANLY — matched, and the cost barely moves. The largest group and the least interesting.
//
// COST WILL MOVE is the group that earns the screen. A bracelet going from €412 to €498 is the margin
// a shipment is about to collapse, and it is the one thing a spreadsheet would never have told you.
// It sits SECOND rather than first because the unmatched lines are the ones that can still be fixed,
// and fixing them changes the allocation — which changes these numbers. Reviewing a cost move before
// the denominator is settled is reviewing a figure that is about to change.
//
// Pure, so the ordering is testable without a database. The divergence flag itself is computed in
// lib/invoices/divergence.ts and arrives on the line; this file does not decide what "enough to
// matter" means, it only reads the answer.

export type GroupKey = 'unmatched' | 'moved' | 'clean'

export interface LineGroup {
  key: GroupKey
  label: string
  lines: InvoiceLine[]
}

const LABEL: Record<GroupKey, string> = {
  unmatched: 'NEEDS A MATCH',
  moved: 'COST WILL MOVE',
  clean: 'MATCHED CLEANLY',
}
const ORDER: GroupKey[] = ['unmatched', 'moved', 'clean']

export function groupOf(line: InvoiceLine): GroupKey {
  // A SKIPPED line is not unmatched. The owner said "don't", which is a decision already made, and
  // putting it back in the group that means "you still have to decide" would ask them twice.
  if (line.status === 'unmatched') return 'unmatched'
  if (line.divergence) return 'moved'
  return 'clean'
}

export function groupLines(lines: InvoiceLine[]): LineGroup[] {
  return ORDER
    .map((key) => ({
      key,
      label: LABEL[key],
      // Largest move first inside COST WILL MOVE — the biggest threat to a margin is the one to read
      // first. The other two keep document order, because that is the order the paper is in and the
      // owner is checking against paper.
      lines: key === 'moved'
        ? lines.filter((l) => groupOf(l) === key)
            .sort((a, b) => Math.abs(b.divergence?.deltaRelative ?? 0) - Math.abs(a.divergence?.deltaRelative ?? 0))
        : lines.filter((l) => groupOf(l) === key),
    }))
    .filter((g) => g.lines.length > 0)
}

/**
 * Coverage as a whole number, and it FLOORS rather than rounds.
 *
 * Found by probing the real data: Primavera is 99.6% matched — 7 of its 133 lines were set aside —
 * and `Math.round` printed "100% matched" for it. On a screen whose entire argument is coverage, that
 * is the one rounding error that must not happen: 100% means every line is accounted for, and a bill
 * that reads 100% while seven lines carry no freight is telling the owner the opposite of the truth.
 *
 * The floor is clamped up to 1 rather than down to 0 for the same reason in the other direction: a
 * bill with one matched line out of four hundred has done SOMETHING, and "0% matched" beside a
 * drawn bar reads as a failure to run rather than a small result.
 */
export function coveragePct(ratio: number): number {
  if (ratio >= 1) return 100
  if (ratio <= 0) return 0
  return Math.max(1, Math.floor(ratio * 100))
}

/** Skipped lines, which belong to none of the three: a decision already made, shown as its own count. */
export const skippedCount = (lines: InvoiceLine[]) => lines.filter((l) => l.status === 'skipped').length

export type ApplyReason = 'ok' | 'coverage' | 'applied' | 'rate' | 'nothing' | 'currency' | 'failed'

/**
 * What the slot says, and whether Apply is live.
 *
 * The sentence is the RULE in the rule's own words, not an instruction — "80% is needed before costs
 * can be applied" tells an owner what to do next without pretending the button is broken.
 *
 * The same five refusals v1's `blocked` is an OR of (app/landed-cost/[id]/page.tsx). v1 renders every
 * one of them as its own banner simultaneously; a slot has room for one sentence, so they are ordered
 * by what has to be fixed FIRST. Coverage is deliberately LAST, which is what makes `overridable`
 * below a one-line test rather than a repeat of v1's four-term condition.
 */
export function applyState(input: {
  ratio: number
  minCoverage: number
  matchedLines: number
  status: string
  foreignWithoutRate: boolean
  /** Freight recorded in something other than base currency. The RPC refuses it and has no override. */
  freightNotInBase: boolean
  /** The document could not be read, so there are no line values to spread anything across. */
  extractionFailed: boolean
}): { can: boolean; reason: ApplyReason } {
  if (input.status === 'applied') return { can: false, reason: 'applied' }
  if (input.extractionFailed) return { can: false, reason: 'failed' }
  if (input.matchedLines === 0) return { can: false, reason: 'nothing' }
  // A foreign invoice with no exchange rate has line values in a currency the costs are not in. The
  // allocation would run and every figure it wrote would be wrong by the rate.
  if (input.foreignWithoutRate) return { can: false, reason: 'rate' }
  // Freight arrives from the forwarder in base currency and is never converted. A figure denominated
  // in anything else is a wrong number rather than a judgement, so it blocks with no way past.
  if (input.freightNotInBase) return { can: false, reason: 'currency' }
  if (input.ratio < input.minCoverage) return { can: false, reason: 'coverage' }
  return { can: true, reason: 'ok' }
}

/**
 * Coverage is the ONLY refusal the owner is entitled to overrule, and v1 says why: a missing rate and
 * a mis-denominated freight figure are not judgements, they are wrong numbers, and there is no button
 * for those. Low coverage is a judgement — the freight of the unmatched goods lands on the matched
 * products, the screen says so, and an owner who has read that may still be right to go ahead.
 *
 * Equivalent to v1's `below && !rateMissing && !wrongFreightCurrency && cov.matchedLines > 0` by the
 * ordering above: 'coverage' is only reached once every other refusal has been ruled out.
 */
export const overridable = (reason: ApplyReason) => reason === 'coverage'
