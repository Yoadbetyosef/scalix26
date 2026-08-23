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
    expect(src('components/orders/line-item-fields.tsx')).toMatch(/Product <span className="text-red-600" aria-hidden>\*<\/span>/)
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
    expect(upd).toMatch(/if \(back\.length\) await sb\.from\('order_line_items'\)\.insert\(back\)/)
  })

  it('throws instead of returning 200 with the items gone', () => {
    expect(store).toMatch(/The items could not be saved: \$\{lineErr\.message\}\. The order is unchanged\./)
    expect(store).toMatch(/The order was created but its items could not be saved/)
  })

  it('leaves no unchecked insert on either path', () => {
    // The whole fault was one line: `await sb.from('order_line_items').insert(...)` with no error
    // read, on create AND on update. Both now destructure it; the only bare insert left is the
    // restore, whose own failure is already inside the throw that follows it.
    const inserts = (store.match(/from\('order_line_items'\)[\s\S]{0,40}?\.insert\(/g) ?? []).length
    const checked = (store.match(/const \{ error: lineErr \} = await sb\.from\('order_line_items'\)/g) ?? []).length
    expect(inserts).toBe(3)
    expect(checked).toBe(2)
  })
})
