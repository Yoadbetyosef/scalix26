import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { billsLine } from './line'
import { coveragePct } from './groups'
import { GROUPS } from '../nav'
import { NAV_ICONS } from '../nav-icons'

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

  it('and reads every line on the page in one query PER PAGE, not one per bill', () => {
    // The loop is over pages of rows, not over bills: `invoiceIds` still goes in whole.
    expect(reader).toContain('.in(\'invoice_id\', invoiceIds)')
    expect(reader).toContain('await readLines(tenantId, invoiceIds)')
    expect(strip(reader)).not.toMatch(/res\.data\.map[^\n]*await|for \(const s of res\.data\)/)
  })

  it('and it PAGES, because a truncated read looks exactly like a bill nobody matched', () => {
    // PostgREST caps a response at 1,000 rows whatever we ask for. listShipments fetches up to 100
    // shipments and real invoices run to 133 lines, so the cap is about eight bills away — and a bill
    // whose lines fell off the end renders "0 lines · 0% matched" with an amber bar, which is the
    // reading of a bill the matcher could not place. Identical symptom, unrelated cause.
    expect(reader).toContain('const PAGE = 1000')
    expect(reader).toContain('.range(from, from + PAGE - 1)')
    // A range with no order is a range over an unspecified sequence: a row can arrive twice or never.
    expect(reader).toContain(".order('id')")
    expect(reader).toContain('if (page.length < PAGE) break')
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
    expect(GROUPS.flatMap((g) => g.items).find((i) => i.href === '/v2/bills')?.module).toBe('landed_cost')
    expect(read('../../../../lib/modules.ts')).toContain("{ prefix: '/landed-cost', module: 'landed_cost' }")
  })

  it('and the row has a glyph, like every other row in BUSINESS', () => {
    expect(NAV_ICONS['Supplier bills']).toBeTruthy()
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
    expect(apply).toContain('if (acknowledge) body.acknowledgeDivergence = true')
    expect(apply).toContain('I have read these — apply')
    // Exactly one caller passes acknowledge=true, and it is the button rendered BESIDE the list the
    // server sent back. v1 sent it unconditionally from a block that only assumed the banner was on
    // screen; on 7 Aug 2026 a stale tab moved 166 products' costs with a record saying otherwise.
    expect((apply.match(/void apply\([^)]*, true\)/g) ?? [])).toHaveLength(1)
  })

  it('and the flags of a refused attempt survive the acknowledgement', () => {
    // An override that dropped on the way to the acknowledgement would come back as a coverage
    // refusal the owner has already answered.
    expect(apply).toContain('setPending(attempt)')
    expect(apply).toContain('void apply(pending ?? { override: false, reapply: false }, true)')
  })

  it('an already-applied bill offers a DIFFERENT button, which says overwrite', () => {
    // Re-applying overwrites what the first apply wrote, so it is asked for by name — and the date of
    // the earlier apply is the information the owner needs, so it travels into the sheet.
    expect(apply).toContain('reapply: true')
    expect(apply).toContain('Apply again')
    expect(apply).toContain('Overwrite')
    expect(apply).toContain('replacing what the apply of ${day(appliedAt)} put there')
    // Never Apply wearing a different word: the two are separate buttons with separate faces.
    expect(read('../v2-tokens.css')).toContain('.v2 .v2-bl-apply[data-again]')
  })

  it('the coverage gate has an override, and nothing else does', () => {
    // v1's rule, in v1's words: a missing rate and a mis-denominated freight figure are not
    // judgements, they are wrong numbers, and there is no button for those.
    expect(groups).toContain("export const overridable = (reason: ApplyReason) => reason === 'coverage'")
    expect(apply).toContain('{!canApply && canOverride && !busy && (')
    expect(detail).toContain('canOverride={overridable(state.reason)}')
  })

  it('and the override button states the coverage it is stepping around, floored', () => {
    // The one number on this screen that must never flatter the bill it is about to apply.
    expect(apply).toContain('`Apply anyway, at ${coveragePct}% coverage`')
    expect(apply).not.toMatch(/Math\.round\([^)]*(?:ratio|coverage)/i)
    expect(detail).toContain('coveragePct={pct}')
  })

  it('every refusal the database enforces is a refusal the screen shows', () => {
    // v1's `blocked` is an OR of five. A gate softer than the RPC's sends the owner into an error
    // with no field to correct — which is the failure the freight-currency guard exists to prevent.
    for (const reason of ['applied', 'failed', 'nothing', 'rate', 'currency', 'coverage']) {
      expect(groups, reason).toContain(`reason: '${reason}'`)
    }
    expect(detail).toContain('extractionFailed: invoice.status === \'failed\'')
    expect(detail).toContain('freightNotInBase: charges > 0 && shipment.currency.toUpperCase() !== base')
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

describe('the rate and the charges are v1’s components, not new ones', () => {
  const v1 = read('../../../landed-cost/[id]/page.tsx')
  const inputs = read('./[id]/inputs.tsx')
  const detail = strip(read('./[id]/page.tsx'))

  it('the save bodies are character-for-character v1’s', () => {
    // These two fields are the ONLY place in the application that writes supplier_invoices
    // .exchange_rate and landed_cost_shipments.freight_total. A second implementation of a field that
    // gates a cost write is a second set of guards to get wrong — so this asserts the guards are the
    // same text in both files rather than merely equivalent.
    for (const line of [
      'const t = v.trim()',
      'const n = t ? Number(t) : null',
      'if (t && (!Number.isFinite(n) || (n as number) <= 0)) return',
      'if (n === value) return',
      'const n = Number(v.trim() || 0)',
      'if (!Number.isFinite(n) || n < 0 || n === value) return',
      "body: JSON.stringify({ exchangeRate: n }),",
      "body: JSON.stringify({ [field]: n }),",
    ]) {
      expect(v1, `v1: ${line}`).toContain(line)
      expect(inputs, `/v2: ${line}`).toContain(line)
    }
  })

  it('saves on blur — no save button, no debounce', () => {
    expect((inputs.match(/onBlur=\{save\}/g) ?? [])).toHaveLength(2)
    expect(v1).toContain('onChange={(e) => setV(e.target.value)} onBlur={save}')
    expect(inputs).toContain('onChange={(e) => setV(e.target.value)} onBlur={save}')
  })

  it('and takes a new server value by REMOUNTING, not by syncing a prop into state', () => {
    // State derived from a prop would fight the cursor mid-edit. v1 keys on the value; so does this.
    expect(v1).toContain('key={`rate-${invoice.exchangeRate ?? \'\'}`}')
    expect(detail).toContain('key={`rate-${invoice.exchangeRate ?? \'\'}`}')
    expect(detail).toContain('key={`freight-${shipment.freightTotal}`}')
    expect(inputs).not.toMatch(/useEffect/)
  })

  it('a refused save is SHOWN — the one place this is not v1', () => {
    // v1 has `if (r.ok)` with no else, so a refused PATCH leaves the typed value in the box and looks
    // exactly like a saved one. On the field that decides whether Apply may write anything, that is
    // not a carry-over worth honouring.
    expect(inputs).toContain("|| 'That rate did not save.'")
    expect(inputs).toContain("|| 'That figure did not save.'")
  })

  it('the response is discarded and the server re-reads', () => {
    // v1 adopts the PATCH response into client state; this screen is a server component. The re-read
    // is the stronger of the two anyway — setShipmentInputs re-runs reallocate() before it answers,
    // so every other line's share has already moved by the time this returns.
    expect(inputs).toContain('router.refresh()')
    expect(strip(inputs)).not.toMatch(/onSaved/)
  })

  it('and there is somewhere to type the rate at all, which was the whole gap', () => {
    expect(detail).toContain('<BillRate')
    expect(detail).toContain('field="freightTotal"')
    expect(detail).toContain('field="dutiesTotal"')
    expect(detail).toContain('field="otherTotal"')
  })

  it('every figure is labelled with its currency, even where it looks obvious', () => {
    // Four things meet on this surface in three currencies: line values in the invoice's, a rate the
    // owner types, freight off a separate bill in base, and the result in base. An unlabelled number
    // between a EUR field and a USD field is exactly where a wrong one hides.
    expect(detail).toContain('{`Supplier invoice · ${cur}`}')
    expect(detail).toContain('{`Freight forwarder · ${base}`}')
    expect(inputs).toContain('{`${label} (${ccy})`}')
  })

  it('the charges are disabled once applied, and the rate with them', () => {
    expect((strip(read('./[id]/page.tsx')).match(/disabled=\{applied\}/g) ?? [])).toHaveLength(4)
  })
})

describe('the invoice can BE the catalogue', () => {
  const create = read('./[id]/create.tsx')
  const detail = strip(read('./[id]/page.tsx'))

  it('creating products is offered where nothing matched', () => {
    // On an empty catalogue this is not one route to coverage, it is the only one: nothing can be
    // matched to products that do not exist yet. 126 of the applied PRIMAVERA bill's 133 lines carry
    // match_method = 'created', which is this control having been used.
    expect(detail).toContain("{g.key === 'unmatched' && !applied && modules.includes('inventory') && (")
    expect(create).toContain("fetch('/api/invoices/lines/create-products'")
  })

  it('and gated on inventory, because that is what the route requires', () => {
    // A button that comes back "turn on the Inventory module" is a worse answer than no button.
    expect(read('../../../api/invoices/lines/create-products/route.ts')).toContain('createProductsFromLines')
    expect(read('../../../../lib/invoices/store.ts')).toContain("!enabledModulesOf(t).includes('inventory')")
    expect(detail).toContain("const { modules } = await listPageContext('landed_cost')")
  })

  it('it is a SELECTION, never create-everything-unmatched', () => {
    // A catalogue full of rows nobody chose still has to be cleaned by hand afterwards. Select all is
    // a press, not a default.
    expect(create).toContain('picked.size === 0')
    expect(create).toContain('`Select all ${lines.length}`')
    expect(create).toContain('disabled={busy || picked.size === 0 || tooMany}')
  })

  it('the name defaults to the supplier’s own words, unedited', () => {
    // Their shorthand is better evidence than our title-casing, and the SKU beside it is what makes
    // their next invoice match this product instead of making a second one.
    expect(create).toContain('value={names[l.id] ?? l.description ?? \'\'}')
    expect(create).toContain('so the next invoice from them matches these instead of making more.')
  })

  it('and only the names that were TYPED are sent', () => {
    // An absent one means the raw description, which the server reads off the line itself. Sending
    // our copy of it would let a stale screen rename a line.
    expect(create).toContain('body: JSON.stringify({ lineIds: [...picked], names })')
    expect(read('../../../../lib/invoices/store.ts'))
      .toContain("const name = (names[id] ?? (line.description as string) ?? '').trim().slice(0, 200) || 'Untitled'")
  })

  it('the money is on every row, ticked or not', () => {
    // It is what the decision is made WITH — v1 puts the description and the price in front of the
    // person naming the thing, and that reason has to survive the move into a sheet.
    expect(create).toContain('<p className="v2-bl-mkmeta">')
    expect(detail).toContain('amount: exact(l.extended, cur)')
  })

  it('one money formatter on the screen, not a second one inside the client', () => {
    // A client component formatting a different currency on the same page is how two figures that
    // should agree stop agreeing.
    expect(create).not.toMatch(/toLocaleString|Intl\.NumberFormat/)
  })

  it('and it refuses past the route’s own ceiling rather than posting a 400', () => {
    expect(create).toContain('const MAX_AT_ONCE = 500')
    expect(read('../../../api/invoices/lines/create-products/route.ts')).toContain('.max(500)')
  })

  it('creating refreshes the WHOLE screen', () => {
    // Every line that just became matched moves every other line's share of the freight.
    expect(create).toContain('router.refresh()')
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

describe('four things called some variant of "bill"', () => {
  // Read through the REAL exports rather than the file's text. These assertions used to pin source
  // strings — "{ label: 'Bills', href: '/v2/bills', module: 'landed_cost' }" — and a rename the whole
  // point of which was to make the rail clearer broke two tests that had no opinion about clarity.
  // What matters is the shape, and the shape is checkable.
  const items = GROUPS.flatMap((g) => g.items)
  const labelled = (href: string) => items.find((i) => i.href === href)?.label

  it('each row says whose money it is', () => {
    // Invoices = what a CUSTOMER owes the tenant. Supplier bills = what the tenant owes a SUPPLIER
    // for stock. Expenses = everything else the tenant spends. Your plan = what the tenant owes
    // Scalix. Four directions of money; the rail has to say which is which, and "Bills" on its own
    // claimed two of them — which is why a supplier invoice got looked for under the wrong row.
    expect(labelled('/v2/invoices')).toBe('Invoices')
    expect(labelled('/v2/bills')).toBe('Supplier bills')
    expect(labelled('/v2/expenses')).toBe('Expenses')
    expect(items.some((i) => i.label === 'Your plan')).toBe(true)
  })

  it('and neither of the ambiguous names survives anywhere in the rail', () => {
    expect(items.map((i) => i.label)).not.toContain('Billing')
    expect(items.map((i) => i.label)).not.toContain('Bills')
  })

  it('every row with a screen draws a chip — the map is keyed by LABEL', () => {
    // The general form of the bug rather than one instance of it: nav-icons is keyed by label, so
    // renaming a row without renaming its key leaves it undrawn. That is how Invoices shipped with no
    // chip, and how "Supplier bills" would have. Sign Out is an action, not a screen, and still has
    // one; a row with no href is not built yet and is allowed none.
    const undrawn = items.filter((i) => (i.href || i.action) && !NAV_ICONS[i.label]).map((i) => i.label)
    expect(undrawn).toEqual([])
  })

  it('supplier bills stay gated on landed_cost; expenses are gated on nothing', () => {
    // The asymmetry is the point. A locksmith imports nothing and never sees a supplier bill — and
    // that is exactly why Money out read $0 for them, which expenses exist to fix. Gating expenses on
    // a module would reproduce the fault.
    expect(items.find((i) => i.href === '/v2/bills')?.module).toBe('landed_cost')
    expect(items.find((i) => i.href === '/v2/expenses')?.module).toBeUndefined()
  })
})
