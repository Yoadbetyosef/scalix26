import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { billsLine } from './line'

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
