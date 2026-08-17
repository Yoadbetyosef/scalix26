import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const store = read('./store.ts')
const docData = read('./document-data.ts')
const body = read('../../components/orders/document-body.tsx')
const form = read('../../components/orders/order-edit.tsx')
const schema = read('./schema.ts')
const migration = read('../../supabase/migrations/add_order_tax_choice.sql')

describe('the rate is resolved on the SERVER', () => {
  it('the form posts an id and never a percentage', () => {
    // A client that could send its own rate could put 3% on a customer's invoice, and the figure would
    // look entirely ordinary.
    expect(form).toContain('taxChoiceId: f.taxChoiceId || null')
    expect(strip(form)).not.toMatch(/ratePercent:|tax_rate_percent|taxLabel:/)
    expect(schema).toContain('taxChoiceId: z.string().max(24).nullable().optional()')
    expect(strip(schema)).not.toMatch(/taxRatePercent|taxLabel/)
  })

  it('and the server reads label, rate and PROVINCE off the list', () => {
    expect(store).toContain('const picked = taxChoiceById(patch.taxChoiceId ?? null)')
    expect(store).toContain('delivery_province: picked.region')
    expect(store).toContain('tax_label: picked.label')
    expect(store).toContain('tax_rate_percent: picked.ratePercent')
  })

  it('picking the rate sets the place of supply with it — one control, not two', () => {
    // Two controls made it possible to store a rate from one province and a destination from another.
    expect(form).not.toContain('deliveryProvince: f.deliveryProvince')
    expect(form).toContain("import { TAX_CHOICES } from '@/lib/tax/canada'")
  })

  it('an unrecognised id clears the choice rather than half-writing it', () => {
    expect(store).toContain("if (!picked) return { delivery_province: null, tax_kind: null, tax_label: null, tax_rate_percent: null }")
  })

  it('and the snapshot is written after the field map, so it wins', () => {
    const upd = store.slice(store.indexOf('export async function updateOrder'))
    expect(upd.indexOf('for (const [k, col] of Object.entries(map))')).toBeLessThan(upd.indexOf('const snap = taxSnapshotFrom(patch)'))
  })
})

describe('the document renders the snapshot', () => {
  it('the stored choice wins over any live lookup', () => {
    // One province can mean two correct rates, so a live lookup could not pick between them even if
    // rates never changed — and editing tax_rates must not alter a document already sent.
    expect(docData).toContain('const snapshot = taxFromSnapshot(')
    expect(docData).toContain('const tax = snapshot ?? taxOn(order.subtotalCents, rateFor(')
  })

  it('and the live lookup survives for orders raised before the picker', () => {
    // Nothing was backfilled, so those must render exactly as they did.
    expect(docData).toContain('rateFor(extra.deliveryProvince ?? null, rates)')
    expect(migration).toContain('NOTHING IS BACKFILLED, DELIBERATELY')
  })

  it('the place-of-supply rule is untouched', () => {
    // No destination, no tax line, never a 0% line.
    expect(docData).toContain('single most common Canadian tax error')
    // The sentence wraps in the source, so match the clause rather than the line.
    expect(body).toContain('line is a claim that no tax is due')
    expect(body).toContain('{tax && (')
  })
})

describe('the exemption is a claim, printed only when it is made', () => {
  it('the note renders ONLY when the box is ticked', () => {
    // A note left behind after unticking is not a claim, and printing it would put an exemption on a
    // document nobody stood behind.
    expect(docData).toContain('pstExemptionNote: extra.pstExempt ? (extra.pstExemptionNote?.trim() || null) : null')
  })

  it('and it prints beneath the tax line, in both copies', () => {
    const b = strip(body)
    expect(b.indexOf('{tax && (')).toBeLessThan(b.indexOf('{pstExemptionNote && ('))
    for (const p of ['../../app/orders/[id]/document/[type]/page.tsx', '../../app/e/[token]/page.tsx']) {
      expect(read(p), p).toContain('pstExemptionNote={data.pstExemptionNote}')
    }
  })

  it('off by default, at the database', () => {
    expect(migration).toContain('pst_exempt          boolean NOT NULL DEFAULT false')
  })

  it('nothing validates the claim, and nothing pretends to', () => {
    // Free text, no shape. The seller is the one who has to defend it.
    // (`certificateLab` in this same file is a GIA/IGI grading lab — an unrelated jewellery field, and
    //  the reason this asserts the note's own declaration rather than searching for the word.)
    expect(schema).toContain('pstExemptionNote: z.string().max(300).nullable().optional()')
    const note = schema.slice(schema.indexOf('pstExemptionNote:'))
    expect(note.slice(0, 120)).not.toMatch(/\.regex\(|\.refine\(|\.email\(/)
    expect(migration).toContain('a record of a claim, not a validated exemption')
  })
})

describe('the snapshot cannot be half-written', () => {
  it('the database refuses a label without a rate, or a rate without a label', () => {
    expect(migration).toContain('CHECK ((tax_label IS NULL) = (tax_rate_percent IS NULL))')
  })

  it('and tax_kind can only be the two readings', () => {
    expect(migration).toContain("CHECK (tax_kind IS NULL OR tax_kind IN ('gst_only', 'combined'))")
    // Not 'wholesale'/'retail' — those name a kind of CUSTOMER, which nothing here can support. The
    // migration's PROSE quotes both words to say so, hence stripping the comments before asserting.
    const sql = migration.replace(/^--.*$/gm, ' ')
    expect(sql).not.toMatch(/'wholesale'|'retail'/)
    expect(sql).toContain("'gst_only', 'combined'")
  })
})

describe('the orders list stopped calling a link a status', () => {
  const listPage = read('../../app/orders/page.tsx')

  it('the fake column is gone entirely', () => {
    // It was an unlabelled 7th cell holding a hardcoded blue "Open" — the open-this-order affordance,
    // immediately right of the real Stage column, reading as a status that never changed because it
    // was a string literal. Every tenant saw it.
    expect(listPage).not.toMatch(/text-blue-600">Open</)
    expect(listPage).not.toContain('0.8fr_1fr_auto')
    expect(strip(listPage)).not.toMatch(/'Requested', ''/)
  })

  it('and the row is still the link', () => {
    expect(listPage).toContain('<Link key={o.id} href={`/orders/${o.id}`}')
  })

  it('the stage chip is the status, and a finished job reads quieter', () => {
    expect(listPage).toContain('isTerminalStage(o.stage)')
    expect(listPage).toContain('{STAGE_LABELS[o.stage]}')
  })
})

describe('a refused stage write is no longer silent', () => {
  it('the update error is read, not discarded', () => {
    // It returned ok on a refused update: the screen refreshed and the stage was simply unchanged.
    // 'finished' makes it reachable, because the DATABASE has to be told about that stage.
    expect(store).toContain("const { error } = await sb.from('orders').update({ stage: to")
    expect(store).toContain("error.code === '23514'")
    expect(store).toContain('run add_order_finished_stage.sql')
  })

  it('and the board gives terminal stages no column', () => {
    // A column that only ever accumulates is a list, not a stage of work.
    expect(read('../../app/orders/board/page.tsx')).toContain("s !== 'cancelled' && s !== 'finished'")
  })

  it('finishing does not forbid invoicing later', () => {
    // invoiced_at is a separate timestamp and the two stay independent — see finish.ts.
    expect(read('../../app/orders/[id]/page.tsx')).toContain("(o.stage === 'completed' || o.stage === 'finished')")
  })
})

describe('one photo on the invoice, the gallery on the estimate', () => {
  const panel = read('../../components/orders/attachments-panel.tsx')
  const imgMigration = read('../../supabase/migrations/add_order_invoice_image.sql')

  it('the invoice prints only the chosen image', () => {
    expect(docData).toContain("const forInvoice = type === 'invoice'")
    expect(docData).toContain('images.filter((i) => i.id === (extra.invoiceImageId ?? null))')
  })

  it('and the estimate is unchanged — reference material belongs there', () => {
    expect(docData).toContain(': images')
    // Both entry points now say which document they are.
    expect(read('../../app/orders/[id]/document/[type]/page.tsx')).toContain('loadOrderDocument(a.tenantId, id, type)')
    expect(read('../../app/e/[token]/page.tsx')).toContain('loadOrderDocument(share.tenantId, share.orderId, share.docType)')
  })

  it('nothing chosen prints NO image, not the first upload', () => {
    // There is no render-vs-final distinction in the data — it lives in the filename and in her head.
    // So the alternative to "none" is not "the right one", it is "whichever was uploaded first".
    expect(imgMigration).toContain('Nothing chosen means the invoice prints')
    expect(panel).toContain('it will print without one')
  })

  it('only PUBLIC images can be chosen', () => {
    // An internal file is filtered out of the customer's document one layer down, so choosing one
    // would store a preference that silently did nothing.
    expect(panel).toContain("isImage(x.mimeType) && x.visibility === 'public' && (")
  })

  it('a failed write puts the old choice back', () => {
    // Otherwise the panel claims a photo is on an invoice that it is not.
    expect(panel).toContain('setChosen(previous)')
  })

  it('the unwired per-line column is left alone', () => {
    // order_line_items.image_attachment_id exists and is wired to nothing. Half-wiring it would leave
    // two columns that both look like the answer.
    expect(imgMigration).toContain('order_line_items.image_attachment_id')
    expect(strip(docData)).not.toContain('image_attachment_id')
    expect(strip(panel)).not.toContain('image_attachment_id')
  })

  it('deleting the attachment un-chooses it rather than deleting the order', () => {
    expect(imgMigration).toContain('ON DELETE SET NULL')
  })
})
