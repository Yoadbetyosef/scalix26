import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { billsLine } from './line'
import { coveragePct } from './groups'

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const list = strip(read('./page.tsx'))
const reader = read('../../../../lib/invoices/bills-read.ts')
const css = read('../v2-tokens.css')
const ref = read('../../../../docs/miles/supplier-invoices.html')

const block = (() => {
  const marker = css.indexOf('SUPPLIER BILLS — docs/miles/supplier-invoices.html')
  const start = css.lastIndexOf('/*', marker)
  let at = marker
  for (;;) {
    at = css.indexOf('\n/* ═', at + 1)
    if (at < 0) return css.slice(start)
    const title = css.slice(at, at + 400).split('\n')[2] ?? ''
    if (!title.trim().startsWith('SUPPLIER BILLS')) return css.slice(start, at)
  }
})()

const bill = (over: Partial<Parameters<typeof billsLine>[0]> = {}) =>
  ({ waiting: [], applied: [], other: [], total: 0, ...over }) as Parameters<typeof billsLine>[0]
const rows = (n: number, status = 'waiting') => Array.from({ length: n }, () => ({ status })) as never[]

describe('the values come from the reference', () => {
  it('the state colours are the file’s own', () => {
    for (const [name, hex] of [['hold', '#F5A524'], ['acid', '#D9F224'], ['red', '#FF3B5C']] as const) {
      expect(ref, name).toContain(`--${name}:${hex}`)
    }
    expect(block).toContain('--bl-wait: #F5A524;')
    expect(block).toContain('--bl-done: #D9F224;')
    expect(block).toContain('--bl-moved: #FF3B5C;')
  })

  it('and are NOT shared with the invoices block, which answers a different question', () => {
    // An invoice's spine says where the MONEY stands; a bill's says whether a DECISION has been made.
    // They share two hex values today, and one variable serving both is how a change to one silently
    // restates the other.
    expect(block).not.toContain('--iv-part')
    expect(block).not.toContain('--iv-paid')
  })

  it('the row, the bar and the slot take the reference’s geometry', () => {
    expect(block).toMatch(/\.v2-bl-row \{ display: flex; gap: 13px; padding: 15px 14px/)
    expect(block).toMatch(/\.v2-bl-bar \{ width: 3px/)
    expect(block).toMatch(/\.v2-bl-covbar \{ height: 5px/)
    expect(block).toMatch(/\.v2-bl-lbar \{ width: 3px/)
    expect(block).toMatch(/\.v2-bl-note \{[^}]*border-radius: 14px/)
  })
})

describe('coverage is the headline, not the total', () => {
  it('the bar is amber below the gate and acid at or above it', () => {
    // The colour IS the rule: a bill that cannot be applied must not look like one that can.
    expect(block).toContain('.v2 .v2-bl-covbar i { display: block; height: 100%; border-radius: 5px; background: var(--bl-done); }')
    expect(block).toContain('.v2 .v2-bl-covbar[data-low] i { background: var(--bl-wait); }')
    expect(list).toContain('data-low={b.belowGate || undefined}')
  })

  it('and "below the gate" is MIN_COVERAGE, not a number typed on the screen', () => {
    expect(reader).toContain("import { MIN_COVERAGE } from './types'")
    expect(reader).toContain('belowGate: cov.ratio < MIN_COVERAGE')
    expect(strip(list)).not.toMatch(/0\.8|80\s*%/)
  })

  it('no bar at all while a document is still being read', () => {
    // A 0% bar on something nobody has finished looking at is a claim about the matching rather than
    // a report of it.
    expect(list).toContain('{!quiet && (')
  })
})

describe('the reader goes through one door', () => {
  it('it calls listShipments rather than querying the table itself', () => {
    // That function is where the tenant gate lives. A second door onto landed_cost_shipments is a
    // second thing that can forget it.
    expect(reader).toContain("import { listShipments } from './store'")
    expect(strip(reader)).not.toContain("from('landed_cost_shipments')")
  })

  it('and reads every line on the page in ONE query, not one per bill', () => {
    expect(reader).toContain('.in(\'invoice_id\', invoiceIds)')
    expect(strip(reader)).not.toMatch(/for \([^)]*\)\s*\{[^}]*await/)
  })

  it('coverage is computed by the pipeline’s own function', () => {
    // Not a second definition of what "matched" means. allocate.ts owns it and the RPC agrees with it.
    expect(reader).toContain("import { coverage } from './allocate'")
  })

  it('a total is never zero when there are lines to add up', () => {
    expect(reader).toContain('totalValue: inv?.grandTotal ?? cov.totalValue')
  })
})

describe('the opening line', () => {
  const say = (l: Parameters<typeof billsLine>[0]) => billsLine(l).map((s) => s.text).join('')

  it('names who the bottleneck is', () => {
    const segs = billsLine(bill({ waiting: rows(1), applied: rows(1, 'applied'), total: 2 }))
    expect(segs.filter((s) => s.accent)).toHaveLength(1)
    expect(say(bill({ waiting: rows(1), applied: rows(1, 'applied'), total: 2 })))
      .toBe('2 bills received. One is waiting on you.')
    expect(say(bill({ waiting: rows(3), total: 3 }))).toBe('3 bills received. 3 are waiting on you.')
  })

  it('says nothing rather than padding a zero', () => {
    expect(say(bill())).toBe('No supplier bills yet.')
    expect(say(bill({ applied: rows(2, 'applied'), total: 2 }))).toBe('All 2 bills applied.')
    expect(say(bill({ applied: rows(1, 'applied'), total: 1 }))).toBe('One bill, applied.')
  })

  it('prefers the state that will change on its own', () => {
    expect(say(bill({ other: rows(1, 'reading'), total: 1 }))).toBe('1 bill received. One is still being read.')
    // A failure is the owner's problem, so it accents; a read in progress is not, so it does not.
    const failed = billsLine(bill({ other: rows(1, 'failed'), total: 1 }))
    expect(failed.filter((s) => s.accent)).toHaveLength(1)
    expect(billsLine(bill({ other: rows(1, 'reading'), total: 1 })).filter((s) => s.accent)).toHaveLength(0)
  })

  it('never accents twice — two accents is no accent', () => {
    for (const l of [bill({ waiting: rows(2), other: rows(1, 'failed'), total: 3 }), bill({ waiting: rows(1), total: 1 })]) {
      expect(billsLine(l).filter((s) => s.accent).length).toBeLessThanOrEqual(1)
    }
  })
})

describe('the screen is gated and reachable', () => {
  it('on landed_cost, which now means more than it used to', () => {
    expect(list).toContain("listPageContext('landed_cost')")
    expect(read('../nav.ts')).toContain("{ label: 'Bills', href: '/v2/bills', module: 'landed_cost' }")
    expect(read('../../../../lib/modules.ts')).toContain("{ prefix: '/landed-cost', module: 'landed_cost' }")
  })

  it('and the row has a glyph, like every other row in BUSINESS', () => {
    expect(read('../nav-icons.tsx')).toContain('Bills: Truck,')
  })

  it('waiting is listed FIRST, whatever the dates say', () => {
    const body = list.slice(list.indexOf('<Group label='))
    expect(body.indexOf('WAITING ON YOU')).toBeLessThan(body.indexOf('APPLIED'))
  })
})

describe('reviewing one bill', () => {
  const detail = strip(read('./[id]/page.tsx'))
  const apply = read('./[id]/apply.tsx')
  const match = read('./[id]/match.tsx')
  const groups = read('./groups.ts')

  it('the groups run in the order the work happens in', () => {
    // Unmatched first because fixing those CHANGES the cost moves below them — reviewing a cost move
    // before the denominator is settled is reviewing a figure that is about to change.
    expect(groups).toContain("const ORDER: GroupKey[] = ['unmatched', 'moved', 'clean']")
    for (const label of ['NEEDS A MATCH', 'COST WILL MOVE', 'MATCHED CLEANLY']) {
      expect(groups).toContain(label)
      expect(ref).toContain(label)
    }
  })

  it('a SKIPPED line is not asked about again', () => {
    // "The owner said don't" is a decision already made. Putting it back under "you still have to
    // decide" would ask them twice.
    expect(groups).toContain("if (line.status === 'unmatched') return 'unmatched'")
    expect(match).toContain('choose(null, true)')
  })

  it('the biggest cost move is read first', () => {
    expect(groups).toContain('Math.abs(b.divergence?.deltaRelative ?? 0) - Math.abs(a.divergence?.deltaRelative ?? 0)')
  })

  it('the note says the CONSEQUENCE, not the count', () => {
    // "31 lines are unmatched" is a fact nobody can act on.
    expect(detail).toContain('would carry all {money(charges, base)}')
  })

  it('a foreign invoice with no rate cannot be applied, and says why', () => {
    // Every cost it wrote would be wrong by the rate.
    expect(groups).toContain("if (input.foreignWithoutRate) return { can: false, reason: 'rate' }")
    expect(detail).toContain('foreignWithoutRate: isForeign && !invoice.exchangeRate')
  })

  it('the slot states the RULE in the rule’s own words', () => {
    expect(detail).toContain('{Math.round(MIN_COVERAGE * 100)}% is needed before costs can be applied.')
    // Never a number typed onto the screen.
    expect(detail).not.toMatch(/\b80%/)
  })

  it('the divergence 409 is treated as a question, not a failure', () => {
    // It is the write asking to be confirmed. acknowledgeDivergence is what gets RECORDED, so a
    // default would turn the audit trail into a lie about what anybody saw.
    expect(apply).toContain('if (res.status === 409 && j.needsAcknowledgement) {')
    expect(apply).toContain("body: JSON.stringify(acknowledge ? { acknowledgeDivergence: true } : {})")
    expect(apply).toContain('I have read these — apply')
  })

  it('and an already-applied bill does not offer the same button with a different word', () => {
    // Re-applying OVERWRITES the first apply and needs its own sentence about the earlier date.
    expect(apply).toContain('if (alreadyApplied) {')
    expect(apply).not.toContain('reapply: true')
  })

  it('matching a line refreshes the WHOLE screen', () => {
    // Freight is spread across matched lines, so matching one moves every other line's share.
    expect(match).toContain('router.refresh()')
    expect(match).not.toMatch(/setLines\(|splice\(/)
  })

  it('the typed search and the shortlist are the SAME scorer', () => {
    // A product that ranks first when typed and fourth when suggested is two matchers disagreeing in
    // front of the owner.
    expect(match).toContain('/api/invoices/lines/${lineId}?q=')
    expect(read('../../../api/invoices/lines/[id]/route.ts')).toContain('suggestForLine((await params).id, q)')
    expect(read('../../../../lib/invoices/store.ts')).toContain('? { id: l.id as string, sku: null, description: typed }')
  })

  it('and the picker lives in /v2 rather than linking to the old screen', () => {
    // no-escape.test.ts fails the build for a row that leaves the preview; this is also the only
    // action that can move a bill above the gate.
    expect(detail).toContain('<MatchLine lineId={l.id}')
    expect(detail).not.toContain('/landed-cost/')
  })
})

describe('coverage is floored, never rounded up', () => {
  it('99.6% does not read as 100%', () => {
    // Found by probing the real data: Primavera is 133 lines with 7 set aside, and Math.round printed
    // "100% matched" for it. 100% means every line is accounted for. A bill that reads 100% while
    // seven lines carry no freight tells the owner the opposite of the truth.
    expect(coveragePct(0.996)).toBe(99)
    expect(coveragePct(0.9999)).toBe(99)
    expect(coveragePct(1)).toBe(100)
  })

  it('and a small result does not read as no result', () => {
    // "0% matched" beside a drawn bar reads as a failure to run rather than one line out of four hundred.
    expect(coveragePct(0.0025)).toBe(1)
    expect(coveragePct(0)).toBe(0)
  })

  it('both screens use it — neither rounds on its own', () => {
    expect(list).toContain('coveragePct(b.coverage.ratio)')
    expect(strip(read('./[id]/page.tsx'))).toContain('coveragePct(cov.ratio)')
    for (const f of ['./page.tsx', './[id]/page.tsx']) {
      expect(strip(read(f)), f).not.toMatch(/Math\.round\([^)]*ratio[^)]*\* 100\)/)
    }
  })
})

describe('the empty state, and the upload it promises', () => {
  const upload = read('./upload.tsx')

  it('does NOT say the same sentence twice', () => {
    // It rendered the opening line above the empty state, and both read "No supplier bills yet."
    // stacked. /v2/invoices already had the right shape: the line belongs to the LIST, so it goes
    // inside the non-empty branch.
    const body = list.slice(list.indexOf('v2-ag-inner'))
    expect(body.indexOf('list.total === 0 ? (')).toBeLessThan(body.indexOf('v2-lin'))
    expect((list.match(/No supplier bills yet/g) ?? [])).toHaveLength(1)
  })

  it('and the empty state carries the action, not just the promise', () => {
    // "Upload one and it gets read" beside no control is a promise the screen cannot keep.
    expect(list).toContain('Upload one and it gets read')
    expect(list).toContain('<UploadBill tone="empty" />')
  })

  it('the header has one too, like every other /v2 screen', () => {
    expect(list).toContain('<div className="v2-hacts">')
    expect(list).toContain('<UploadBill />')
  })

  it('one component, two placements — so they cannot drift', () => {
    expect((list.match(/<UploadBill/g) ?? [])).toHaveLength(2)
  })

  it('and BOTH wear the header-action treatment', () => {
    // The empty one used `v2-epri`, which carries only background and colour — every measurement it
    // looks like it has comes from `.v2-eacts button`. Outside a sheet it rendered 18px tall with no
    // padding and no radius: a black rectangle behind text. Measured before and after.
    expect(upload).toContain('className="v2-hact"')
    expect(upload).toContain('data-tone="primary"')
    expect(strip(upload)).not.toContain('v2-epri')
  })

  it('posts to the SAME route v1 uses — it is not a v1-only path', () => {
    // /landed-cost is a second CALLER of this route, not the owner of it. Linking there instead
    // would leave the preview, which no-escape refuses and which is a dead end on a phone.
    expect(upload).toContain("fetch('/api/invoices/shipments', { method: 'POST', body })")
    expect(strip(upload)).not.toContain('/landed-cost')
  })

  it('refuses a bad file at the picker, with the server’s own rule', () => {
    expect(upload).toContain("import { INVOICE_ACCEPT_ATTR, invoiceFileError } from '@/lib/invoices/types'")
    expect(upload).toContain('const problem = invoiceFileError(file.name, file.size)')
  })

  it('reads the response with readJson, not res.json()', () => {
    // An oversized upload is refused by the platform edge with PLAIN TEXT, before the route exists
    // as far as Vercel is concerned — res.json() would throw a parse error over the real one.
    expect(upload).toContain('await readJson<')
    expect(strip(upload)).not.toMatch(/await res\.json\(\)/)
  })

  it('a duplicate is shown and does not block', () => {
    // Re-uploading after a failed extraction is legitimate; the owner knows which of the two they
    // meant. So the warning holds the NAVIGATION, not the upload.
    expect(upload).toContain('if (d.duplicate) { setDupe(d.duplicate); router.refresh(); return }')
    expect(upload).toContain('Open the one you already have')
  })
})
