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

// The block that stood here asserted that no due date was invented — correct while `invoices` had no
// due-date column, and obsolete the moment add_invoice_settings.sql landed. What replaced it is
// "due dates, and the overdue group" below, which asserts the real rule: a date is STAMPED at issue
// from agreed terms, and an invoice with none is never overdue.

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

describe('due dates, and the overdue group', () => {
  const settings = read('../../../../lib/core/invoice-settings.ts')

  it('the due date is STAMPED at issue, not computed on render', () => {
    const docs = read('../../../../lib/core/documents.ts')
    expect(docs).toContain('due.setUTCDate(due.getUTCDate() + settings.netDays)')
    expect(docs).toContain("stamp.due_on = due.toISOString().slice(0, 10)")
    // Invoices only. An estimate has nothing to pay yet and a quote is not owed.
    expect(docs).toContain("if (type === 'invoice') {")
  })

  it('no due date is never overdue — that is not the same as "not yet late"', () => {
    expect(lib).toContain("const late = !isDraft && status !== 'paid' && days !== null && days < 0")
  })

  it('a PAID invoice is never overdue, however old the date', () => {
    expect(lib).toContain("status === 'paid' ? 'paid' : late ? 'overdue' : 'waiting'")
  })

  it('the OVERDUE band cell appears only when something is', () => {
    // A fourth cell reading $0 every day stops being read, and then is not read on the day it matters.
    expect(list).toContain('{list.overdueCount > 0 && (')
  })

  it('the row says DAYS LATE or DUE IN, and STILL DUE when no date was agreed', () => {
    expect(list).toContain("`${Math.abs(r.daysToDue ?? 0)} ${Math.abs(r.daysToDue ?? 0) === 1 ? 'DAY' : 'DAYS'} LATE`")
    expect(list).toContain("`DUE IN ${r.daysToDue} ${r.daysToDue === 1 ? 'DAY' : 'DAYS'}`")
    expect(list).toContain(": 'STILL DUE'")
  })

  it('the detail shows a due figure only when there is still something to pay', () => {
    // "Due in 11 days" over a paid invoice is a number about nothing.
    expect(detail).toContain('{r.daysToDue !== null && r.outstandingCents > 0 && (')
  })

  it('net days defaults to 14 and 0 means due on issue', () => {
    expect(settings).toContain('export const DEFAULT_NET_DAYS = 14')
    expect(read('./settings.tsx')).toContain('0 means due the day it is issued.')
  })
})

describe('how they pay you', () => {
  const sheet = read('./settings.tsx')

  it('is SNAPSHOTTED at issue, so a sent invoice never changes', () => {
    const docs = read('../../../../lib/core/documents.ts')
    expect(docs).toContain('stamp.payment_instructions = settings.paymentInstructions')
    expect(lib).toContain('paymentInstructions: (inv.payment_instructions as string) ?? null')
  })

  it('a draft previews the current wording and says that is what it is', () => {
    expect(detail).toContain("inv.row.bucket === 'draft' ? await readInvoiceSettings(tenantId) : null")
    expect(detail).toContain('inv.paymentInstructions ?? settings?.paymentInstructions ?? null')
    expect(detail).toContain('The invoice keeps whatever it says when you issue it.')
  })

  it('and the sheet says the same thing before you save', () => {
    // Otherwise an owner fixing a typo would reasonably assume it had gone out to everybody.
    expect(sheet).toContain('a customer&apos;s copy never changes after they have it')
  })

  it('renders at normal weight, NOT as small print', () => {
    // This is the line the customer acts on. studio's terms are 11px grey, which is right for terms
    // and conditions and wrong for this.
    expect(block).toMatch(/\.v2-iv-payt \{ font-size: 14px; line-height: 1\.6/)
    expect(block).not.toMatch(/\.v2-iv-payt \{[^}]*font-size: 1[12]px/)
  })

  it('keeps line breaks — bank details are a shape as much as a string', () => {
    expect(block).toMatch(/\.v2-iv-payt \{[^}]*white-space: pre-line/)
    expect(sheet).toContain('Line breaks are kept exactly as you type them.')
  })

  it('is typed once, on the screen where the question occurs', () => {
    expect(list).toContain('<PaymentDetails instructions={settings.paymentInstructions} netDays={settings.netDays} />')
    expect(read('../../../api/core/invoice-settings/route.ts')).toContain("requireCoreTenant('invoices')")
  })
})

describe('creating an invoice', () => {
  const nw = read('./new.tsx')
  const pick = read('../contact-pick.tsx')
  const linesRoute = read('../../../api/core/documents/[type]/[id]/lines/route.ts')

  it('the sheet is the transaction — nothing is written until Save', () => {
    // Creating the document first and adding lines as they are typed leaves a numbered, listed, EMPTY
    // draft behind on every abandoned form, and burns an invoice number doing it.
    const save = nw.slice(nw.indexOf('async function save()'))
    expect(save.indexOf("fetch('/api/core/documents'")).toBeGreaterThan(-1)
    expect(nw).not.toMatch(/useEffect\([^)]*fetch\('\/api\/core\/documents'/)
  })

  it('the total is a preview and is never sent', () => {
    expect(nw).toContain('const preview = lines.reduce(')
    const body = nw.slice(nw.indexOf("fetch('/api/core/documents'"), nw.indexOf('// 3 ──'))
    expect(body).not.toMatch(/total|subtotal/)
    // The line payload carries quantity and unit price only; the server derives everything else.
    expect(nw).toContain('unit_price_cents: cents(l.unitPrice),')
  })

  it('has no discount or tax field', () => {
    // Tax is jurisdictional, and a free-text cents box invites a number somebody computed wrong.
    expect(nw).not.toMatch(/discount_cents|tax_cents/)
  })

  it('uses an existing contact, and a 409 means use THAT one', () => {
    // A person typing a number that already belongs to somebody must be shown that somebody — and an
    // invoice must not be refused over it.
    expect(nw).toContain('if (r.duplicateOf) {')
    expect(nw).toContain('contactId = r.duplicateOf.id')
    expect(pick).toContain('if (res.status === 409 && j.duplicateOf) return { ok: false, duplicateOf: j.duplicateOf }')
  })

  it('the picker is shared with the appointment form, not copied', () => {
    expect(nw).toContain("from '../contact-pick'")
    expect(pick).toContain('/api/contacts/search?q=')
  })

  it('the lines route accepts all four document types', () => {
    // It shipped with three while DocType had four — invisible until somebody adds a proposal line.
    expect(linesRoute).toContain("const TYPES = ['estimate', 'quote', 'invoice', 'proposal'] as const")
  })
})

describe('the one failure that survives, survives twice', () => {
  const nw = read('./new.tsx')

  it('the sheet REFUSES to close on a partial create', () => {
    // A toast would vanish and the owner would find a wrong total later — the exact thing this
    // sequencing exists to prevent.
    expect(nw).toContain('onClose={partial ? () => {} : close}')
    expect(nw).toContain("Sheet title={partial ? 'Something did not save' : 'New invoice'}")
  })

  it('and both ways out require having read it', () => {
    expect(nw).toContain("I&apos;ll fix it later")
    expect(nw).toContain('Open {partial.number}')
  })

  it('the message names the invoice, the line, and that the total is wrong', () => {
    expect(nw).toContain('was created, but ${which} of ${usable.length} did not save. Its total is lower than you meant.')
  })

  it('and it is written to the document’s own history, so it outlives the sheet', () => {
    expect(nw).toContain("body: JSON.stringify({ status: 'draft', note: message })")
    expect(lib).toContain("note: (h.note as string) ?? null,")
    expect(detail).toContain('{h.note ?? (h.from ? `${h.from} → ${h.to}` : h.to)}')
  })

  it('writing that note cannot itself break the report', () => {
    // The sheet still says it; history is the durable copy, not the only one.
    expect(nw).toContain('} catch { /* the sheet still says it; this is the durable copy, not the only one */ }')
  })

  it('a clean create goes straight to the invoice', () => {
    expect(nw).toContain('router.push(`/v2/invoices/${docId}`)')
  })
})
