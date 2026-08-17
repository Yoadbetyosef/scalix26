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

/** Skipped lines, which belong to none of the three: a decision already made, shown as its own count. */
export const skippedCount = (lines: InvoiceLine[]) => lines.filter((l) => l.status === 'skipped').length

/**
 * What the slot says, and whether Apply is live.
 *
 * The sentence is the RULE in the rule's own words, not an instruction — "80% is needed before costs
 * can be applied" tells an owner what to do next without pretending the button is broken.
 */
export function applyState(input: {
  ratio: number
  minCoverage: number
  matchedLines: number
  status: string
  foreignWithoutRate: boolean
}): { can: boolean; reason: 'ok' | 'coverage' | 'applied' | 'rate' | 'nothing' } {
  if (input.status === 'applied') return { can: false, reason: 'applied' }
  if (input.matchedLines === 0) return { can: false, reason: 'nothing' }
  // A foreign invoice with no exchange rate has line values in a currency the costs are not in. The
  // allocation would run and every figure it wrote would be wrong by the rate.
  if (input.foreignWithoutRate) return { can: false, reason: 'rate' }
  if (input.ratio < input.minCoverage) return { can: false, reason: 'coverage' }
  return { can: true, reason: 'ok' }
}
