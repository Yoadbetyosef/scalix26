import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { invoicesLine } from './line'

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const list = strip(read('./page.tsx'))
const detail = strip(read('./[id]/page.tsx'))
const record = read('./record.tsx')
const recordCode = strip(record)
const issue = read('./[id]/issue.tsx')
const lib = read('../../../../lib/core/invoice-read.ts')
const css = read('../v2-tokens.css')
const ref = read('../../../../docs/miles/invoices-income.html')

const block = (() => {
  const marker = css.indexOf('INVOICES — docs/miles/invoices-income.html')
  const start = css.lastIndexOf('/*', marker)
  let at = marker
  for (;;) {
    at = css.indexOf('\n/* ═', at + 1)
    if (at < 0) return css.slice(start)
    const title = css.slice(at, at + 400).split('\n')[2] ?? ''
    if (!title.trim().startsWith('INVOICES')) return css.slice(start, at)
  }
})()

describe('the values come from the reference', () => {
  it('the state colours are the file’s own', () => {
    for (const [name, hex] of [['violet', '#8B5CF6'], ['acid', '#D9F224'], ['hold', '#F5A524'], ['red', '#FF3B5C']] as const) {
      expect(ref, name).toContain(`--${name}:${hex}`)
    }
    expect(block).toContain('--iv-sent: #8B5CF6;')
    expect(block).toContain('--iv-paid: #D9F224;')
    expect(block).toContain('--iv-part: #F5A524;')
    expect(block).toContain('--iv-late: #FF3B5C;')
  })

  it('and are NOT shared with the agenda’s meeting-kind variables', () => {
    // Where an appointment happens and where an invoice stands are different questions. One variable
    // serving both is how they drift into each other.
    expect(block).not.toContain('--ag-onsite')
    expect(block).not.toContain('--ag-zoom')
  })

  it('the band, the row and the sheet take the reference’s geometry', () => {
    expect(block).toMatch(/\.v2-iv-bd \{ flex: 1; padding: 15px 16px/)
    expect(block).toMatch(/\.v2-iv-bdv \{[^}]*font-size: 22px/)
    expect(block).toMatch(/\.v2-iv-row \{[^}]*padding: 15px 14px/)
    expect(block).toMatch(/\.v2-iv-bar \{ width: 3px/)
    expect(block).toMatch(/\.v2-iv-fld \{[^}]*height: 46px/)
    expect(block).toContain('grid-template-columns: repeat(3, 1fr); gap: 7px;')
    expect(block).toMatch(/\.v2-iv-save \{[^}]*height: 48px/)
  })
})

describe('the money is derived, never stored', () => {
  it('paid is the sum of allocations and outstanding is the difference', () => {
    expect(lib).toContain('paidBy.set(a.document_id, (paidBy.get(a.document_id) ?? 0) + Number(a.amount_cents))')
    expect(lib).toContain('outstandingCents: total - paid')
    expect(lib).toContain("derivePaymentStatus(total, paid)")
  })

  it('nothing caches a balance', () => {
    expect(lib).not.toMatch(/balance_cents|paid_cents/)
  })

  it('the progress bar is drawn ONLY when partly paid', () => {
    // A bar at 0 or 100 says nothing the figure beside it does not.
    expect(lib).toContain("progress: status === 'partial' && total > 0 ? paid / total : null")
    expect(list).toContain('{r.progress !== null && (')
  })
})

describe('no due date is invented', () => {
  it('the overdue bucket exists and nothing falls into it yet', () => {
    // invoices has no due-date column. issued_at + 14 days would be a number nobody agreed to, shown
    // as though somebody had.
    expect(lib).toContain("export type Bucket = 'overdue' | 'waiting' | 'draft' | 'paid'")
    expect(lib).toContain("const bucket: Bucket = isDraft ? 'draft' : status === 'paid' ? 'paid' : 'waiting'")
    expect(lib).toContain('overdueCents: 0')
  })

  it('and the screen shows no DUE IN or DAYS LATE label', () => {
    expect(list).not.toMatch(/DUE IN|DAYS LATE/)
    // The reference does — this is a deliberate omission, not an oversight.
    expect(ref).toContain('DAYS LATE')
  })
})

describe('recording a payment', () => {
  it('defaults to the balance and can be less', () => {
    expect(record).toContain('useState(dollars(Math.max(0, outstandingCents)))')
    expect(record).toContain('Full balance')
  })

  it('says what would be left, rather than making the owner subtract', () => {
    expect(record).toContain('would still be owed after this.')
  })

  it('allows an over-payment and says so', () => {
    // A rounded transfer or a tip. Refusing it would be this form having an opinion about somebody
    // else's bank statement.
    expect(record).toContain('more than is owed. It will be recorded as paid.')
    expect(record).not.toMatch(/cents > outstandingCents[^)]*\) return/)
  })

  it('carries the method through the route to the RPC', () => {
    expect(record).toContain('method,')
    const route = read('../../../api/core/documents/[type]/[id]/payments/route.ts')
    expect(route).toContain("method: z.enum(['transfer', 'zelle', 'cash', 'cheque', 'card', 'other']).nullable().optional()")
    expect(read('../../../../lib/core/payments.ts')).toContain('p_method: input.method ?? null,')
  })

  it('records a settling payment as a charge and a lesser one as a deposit', () => {
    expect(record).toContain("kind: cents >= outstandingCents ? 'charge' : 'deposit'")
  })

  it('has no WHEN field — the ledger stamps it', () => {
    // A date the owner can type is a date that can disagree with the row, and backdating changes
    // which month a payment lands in. A separate decision.
    // Comments stripped: the note in that file NAMES the field it deliberately omits.
    expect(strip(record)).not.toMatch(/WHEN/)
  })

  it('shows a method nobody recorded as absent, not as "Other"', () => {
    expect(detail).toContain("{p.method ? METHOD_LABEL[p.method] ?? p.method : 'Method not recorded'}")
  })
})

describe('issuing, from the invoice', () => {
  it('confirms before it acts, and says it is final', () => {
    expect(issue).toContain('setConfirming(true)')
    expect(issue).toContain('— final')
  })

  it('refuses when there is nothing to issue, and says why', () => {
    expect(issue).toContain('An invoice with no lines cannot be issued')
    expect(detail).toContain('canIssue={inv.lines.length > 0}')
  })

  it('shows the route’s own sentence on a failure', () => {
    expect(issue).toContain("setErr(j.error || 'That did not issue.')")
  })
})

describe('the opening line', () => {
  const say = (i: Parameters<typeof invoicesLine>[0]) => invoicesLine(i).map((s) => s.text).join('')

  it('accents what is owed, because that is the thing to act on', () => {
    const segs = invoicesLine({ outstandingCents: 613000, outstandingCount: 4, draftCount: 1, paidCount: 7 })
    expect(segs.filter((s) => s.accent)).toHaveLength(1)
    expect(say({ outstandingCents: 613000, outstandingCount: 4, draftCount: 1, paidCount: 7 }))
      .toBe('1 draft not issued. $6,130 owed across 4 invoices.')
  })

  it('says nothing rather than padding a zero', () => {
    expect(say({ outstandingCents: 0, outstandingCount: 0, draftCount: 0, paidCount: 3 })).toBe('Everything issued has been paid.')
    expect(say({ outstandingCents: 0, outstandingCount: 0, draftCount: 2, paidCount: 0 })).toBe('2 drafts not issued. Nothing has been issued yet.')
    expect(say({ outstandingCents: 0, outstandingCount: 0, draftCount: 0, paidCount: 0 })).toBe('No invoices yet.')
  })
})

describe('the screen is gated and reachable', () => {
  it('on the invoices module, in the one nav list both surfaces read', () => {
    expect(list).toContain("listPageContext('invoices')")
    expect(read('../nav.ts')).toContain("{ label: 'Invoices', href: '/v2/invoices', module: 'invoices' }")
  })
})
