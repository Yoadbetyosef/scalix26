import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyLine, lineHasContent, namelessError, namelessLines, type LineDraft } from './line-item-fields'

// "It stopped saving the item information, such as the bracelet quality and price, no matter how many
// times we enter it." — TG Jewellers, 22 Aug 2026, on ORD-9EMWMW96.
//
// Three `updated` events on that order, zero line items, subtotal 0. Both forms sent
// `lines.filter((l) => l.productName.trim())`, so a row carrying a stone, a quality, a metal and a
// price but no Product name was dropped on the CLIENT — the PATCH arrived with lineItems: [], and
// updateOrder deletes every line before it inserts. Each save wiped the order and returned 200.

const line = (over: Partial<LineDraft> = {}): LineDraft => ({ ...emptyLine(), ...over })

describe('a row with something in it is never silently dropped', () => {
  it('recognises the row she was losing: everything but a name', () => {
    const bracelet = line({ productType: 'Bracelet', stoneQuality: 'VS2', metalKarat: '14K Yellow Gold', unitPrice: '1450' })
    expect(lineHasContent(bracelet)).toBe(true)
    expect(namelessLines([bracelet])).toEqual([1])
    expect(namelessError([bracelet])).toMatch(/Item 1 needs a product name/)
  })

  it('says nothing about a genuinely blank row, which is not an item', () => {
    expect(lineHasContent(emptyLine())).toBe(false)
    expect(namelessError([emptyLine()])).toBeNull()
    // The blank row the form always renders must not stop a save.
    expect(namelessError([line({ productName: 'Solitaire ring', unitPrice: '6000' }), emptyLine()])).toBeNull()
  })

  it('says nothing when every filled row is named', () => {
    expect(namelessError([line({ productName: 'Tennis necklace', centerStoneCarat: '17' })])).toBeNull()
  })

  it('counts the rows, and names them', () => {
    const bad = [line({ unitPrice: '10' }), line({ productName: 'Ring' }), line({ stoneType: 'Diamond' })]
    expect(namelessLines(bad)).toEqual([1, 3])
    expect(namelessError(bad)).toMatch(/Items 1, 3 need a product name/)
  })

  it('treats a changed quantity as content, because somebody typed it', () => {
    expect(lineHasContent(line({ quantity: '2' }))).toBe(true)
    expect(lineHasContent(line({ quantity: '1' }))).toBe(false)
  })
})

describe('both forms refuse rather than drop, and say so where she is', () => {
  const src = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
  for (const f of ['components/orders/order-edit.tsx', 'components/orders/order-form.tsx']) {
    it(`${f} checks before it sends`, () => {
      const s = src(f)
      expect(s).toMatch(/const nameless = namelessError\(lines\)\s*\n\s*if \(nameless\) \{ setErr\(nameless\); return \}/)
      // The check has to come BEFORE the request, or the drop has already happened.
      expect(s.indexOf('namelessError(lines)')).toBeLessThan(s.indexOf('await fetch('))
    })
  }
  it('the Product field says it is required before anybody presses Save', () => {
    // The asterisk, not the class it was painted with. The V2 migration moved it from text-red-600
    // to --v2-red-ink, which is the same mark in a red that clears AA; what must not change is that
    // the mark is there, that it is hidden from assistive tech (the input carries aria-required),
    // and that it is on the Product label rather than somewhere kinder to find.
    const s = src('components/orders/line-item-fields.tsx')
    // The id is per line now (`li0-product`, `li1-product`…) so two items on one order do not
    // share it — see the `index` prop. The mark and the aria-required are what this guards.
    expect(s).toMatch(/<label htmlFor=\{`\$\{p\}-product`\}>Product <span[^>]*aria-hidden>\*<\/span><\/label>/)
    // Not [^>]* — an onChange handler contains "=>" and the character class stops at the arrow.
    expect(s).toMatch(/id=\{`\$\{p\}-product`\}[\s\S]{0,200}?required aria-required/)
  })
})

describe('and the write itself cannot lose the old items', () => {
  const store = readFileSync(join(process.cwd(), 'lib/orders/store.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

  it('snapshots before the delete and puts them back if the insert is refused', () => {
    // No transaction is available through PostgREST, so the snapshot IS the transaction.
    const upd = store.slice(store.indexOf('export async function updateOrder'))
    const snap = upd.indexOf("select('*').eq('order_id', id)")
    const del = upd.indexOf(".delete().eq('order_id', id)")
    expect(snap).toBeGreaterThan(-1)
    expect(snap).toBeLessThan(del)
    expect(upd).toMatch(/if \(previousLines\.length\) await sb\.from\('order_line_items'\)\.insert\(previousLines\)/)
    // And a refused ORDER write (after the lines were replaced) restores them too, so the subtotal
    // and the lines can never describe two different orders.
    expect(upd).toMatch(/const restoreLines = async \(\) => \{[\s\S]*?\.delete\(\)\.eq\('order_id', id\)[\s\S]*?insert\(previousLines\)/)
    expect(upd).toMatch(/if \(error\) \{\s*await restoreLines\(\)/)
  })

  it('throws instead of returning 200 with the items gone', () => {
    expect(store).toMatch(/The items could not be saved: \$\{lineErr\.message\}\. The order is unchanged\./)
    expect(store).toMatch(/The order was created but its items could not be saved/)
  })

  it('leaves no unchecked insert on either path', () => {
    // The whole fault was one line: `await sb.from('order_line_items').insert(...)` with no error
    // read, on create AND on update.
    //
    // ── COUNTED BY WHAT IS CHECKED, NOT BY HOW MANY LINES THERE ARE ──────────────────────────────
    //
    // This used to assert two literal counts (3 inserts, 2 destructured). Both writes now go through
    // insertLines(), which added a retry insert for the case where the new columns are missing — so
    // the counts moved and the assertion failed while the property it protects was MORE true than
    // before. A count is a proxy; the property is that no insert's error goes unread.
    const inserts = store.match(/from\('order_line_items'\)[\s\S]{0,80}?\.insert\(/g) ?? []
    expect(inserts.length).toBeGreaterThan(0)

    // Every insert inside insertLines destructures its error...
    const helper = store.slice(store.indexOf('async function insertLines'), store.indexOf('export const LINE_EXTRAS_MIGRATION'))
    expect(helper).toMatch(/const \{ error \} = await sb\.from\('order_line_items'\)\.insert\(rows\)/)
    expect(helper).toMatch(/const retry = await sb\.from\('order_line_items'\)\.insert\(legacy\)/)
    expect(helper).toMatch(/return \{ error: retry\.error, degraded: true \}/)

    // ...and BOTH call sites read what it returns.
    const reads = (store.match(/const \{ error: lineErr, degraded \} = await insertLines\(/g) ?? []).length
    expect(reads).toBe(2)
    expect(store).toMatch(/if \(lineErr\) throw new Error\(`The order was created but its items could not be saved/)
    expect(store).toMatch(/if \(lineErr\) \{/)

    // The bare inserts left are the restores, whose failure is already inside the throw after them.
    expect((store.match(/await sb\.from\('order_line_items'\)\.insert\(previousLines\)/g) ?? []).length).toBe(2)
  })
})
