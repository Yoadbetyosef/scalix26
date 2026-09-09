'use client'

import type { OrderOptionList } from '@/lib/orders/options'
import {
  LENGTH_LIST_KEY, PRODUCT_TYPE_LABEL, PRODUCT_TYPE_LIST_KEY,
  effectiveProductType, fieldFor, type VariableField,
} from '@/lib/orders/product-types'

// The line-item editor, shared by the create form and the edit dialog so the two can never drift.
// Jewelry attributes come from the tenant's own dropdown lists; carats are free numeric entry.
//
// WHICH FIELDS, AND WHAT THEY ARE CALLED, DEPEND ON THE PIECE. A pair of earrings has no ring size and
// no centre stone; a tennis necklace has a length and one total weight. The decision lives in
// lib/orders/product-types.ts so the printed document says the same words — see the note there about
// why the centre-weight column is re-labelled rather than replaced.

export interface LineDraft {
  productType: string; productName: string; description: string; sku: string; quantity: string; unitPrice: string; internalCost: string
  measurements: string; color: string; material: string; customSpec: string
  stoneType: string; stoneOrigin: string; stoneQuality: string; stoneColor: string
  centerStoneShape: string; sideStoneShape: string; metalKarat: string
  centerStoneCarat: string; sideStoneCaratTotal: string
  certificateLab: string; ringSize: string
  /**
   * EVERY side shape on the piece. The only non-string field on this draft, which is why
   * `lineHasContent` had to learn about arrays — see the note there.
   *
   * `sideStoneShape` above stays as the legacy single value and is derived from this on the way out.
   */
  sideStoneShapes: string[]
  /** Millimetres, as typed. A string here like every other numeric field; parsed on the way out. */
  bandWidthMm: string
}

export const emptyLine = (): LineDraft => ({
  productType: '', productName: '', description: '', sku: '', quantity: '1', unitPrice: '', internalCost: '',
  measurements: '', color: '', material: '', customSpec: '',
  stoneType: '', stoneOrigin: '', stoneQuality: '', stoneColor: '',
  centerStoneShape: '', sideStoneShape: '', metalKarat: '',
  centerStoneCarat: '', sideStoneCaratTotal: '',
  certificateLab: '', ringSize: '',
  sideStoneShapes: [], bandWidthMm: '',
})

// Turn the on-screen strings into the API payload. Blank means "not specified", never 0 or "".
export const lineToPayload = (l: LineDraft) => ({
  // Blank stays blank. What the form READ off the product name is never written back as though she
  // had picked it — the inference is a way of showing an old line correctly, not a claim about it.
  productType: l.productType || null,
  productName: l.productName, description: l.description || null, sku: l.sku || null,
  quantity: parseFloat(l.quantity) || 1, unitPriceCents: Math.round((parseFloat(l.unitPrice) || 0) * 100),
  // Empty stays NULL — "not recorded" — rather than becoming 0, which would claim the line was free.
  internalCostCents: l.internalCost.trim() === '' ? null : Math.round((parseFloat(l.internalCost) || 0) * 100),
  measurements: l.measurements || null, color: l.color || null, material: l.material || null, customSpec: l.customSpec || null,
  stoneType: l.stoneType || null, stoneOrigin: l.stoneOrigin || null, stoneQuality: l.stoneQuality || null, stoneColor: l.stoneColor || null,
  centerStoneShape: l.centerStoneShape || null,
  // The array is the truth and the single field is derived from it, so the two can never disagree.
  // Sending both keeps a database that has not had the migration run recording one side shape as it
  // always did, rather than silently recording none.
  sideStoneShapes: l.sideStoneShapes,
  sideStoneShape: l.sideStoneShapes[0] ?? l.sideStoneShape ?? null,
  metalKarat: l.metalKarat || null,
  certificateLab: l.certificateLab || null, ringSize: l.ringSize || null,
  centerStoneCarat: l.centerStoneCarat.trim() === '' ? null : parseFloat(l.centerStoneCarat),
  sideStoneCaratTotal: l.sideStoneCaratTotal.trim() === '' ? null : parseFloat(l.sideStoneCaratTotal),
  // Blank stays NULL — "not recorded" — rather than becoming 0, which on a manufacturing document
  // would read as a band with no width.
  bandWidthMm: l.bandWidthMm.trim() === '' ? null : parseFloat(l.bandWidthMm),
})

// Rehydrate a saved line item back into the form.
export const lineFromSaved = (l: {
  productType?: string | null; productName: string; description: string | null; sku: string | null; quantity: number; unitPriceCents: number
  internalCostCents?: number | null
  measurements: string | null; color: string | null; material: string | null; customSpec: string | null
  stoneType?: string | null; stoneOrigin?: string | null; stoneQuality?: string | null; stoneColor?: string | null
  centerStoneShape?: string | null; sideStoneShape?: string | null; metalKarat?: string | null
  centerStoneCarat?: number | null; sideStoneCaratTotal?: number | null
  certificateLab?: string | null; ringSize?: string | null
  sideStoneShapes?: string[] | null; bandWidthMm?: number | null
}): LineDraft => ({
  productType: l.productType ?? '', productName: l.productName, description: l.description ?? '', sku: l.sku ?? '',
  quantity: String(l.quantity), unitPrice: l.unitPriceCents ? (l.unitPriceCents / 100).toString() : '',
  internalCost: l.internalCostCents === null || l.internalCostCents === undefined ? '' : (l.internalCostCents / 100).toString(),
  measurements: l.measurements ?? '', color: l.color ?? '', material: l.material ?? '', customSpec: l.customSpec ?? '',
  stoneType: l.stoneType ?? '', stoneOrigin: l.stoneOrigin ?? '', stoneQuality: l.stoneQuality ?? '', stoneColor: l.stoneColor ?? '',
  centerStoneShape: l.centerStoneShape ?? '', sideStoneShape: l.sideStoneShape ?? '', metalKarat: l.metalKarat ?? '',
  centerStoneCarat: l.centerStoneCarat == null ? '' : String(l.centerStoneCarat),
  sideStoneCaratTotal: l.sideStoneCaratTotal == null ? '' : String(l.sideStoneCaratTotal),
  certificateLab: l.certificateLab ?? '', ringSize: l.ringSize ?? '',
  // A line saved before the array existed rehydrates from its single value, so opening an old order
  // shows the shape it has rather than an empty control.
  sideStoneShapes: l.sideStoneShapes?.length ? l.sideStoneShapes : (l.sideStoneShape ? [l.sideStoneShape] : []),
  bandWidthMm: l.bandWidthMm == null ? '' : String(l.bandWidthMm),
})


// ── A LINE WITH SOMETHING IN IT MUST NOT BE THROWN AWAY IN SILENCE ─────────────────────────────────
//
// Both forms sent `lines.filter((l) => l.productName.trim())`, which is right about which lines are
// real and catastrophic about the ones it drops. A line carrying a stone, a quality, a metal and a
// price but no Product name was discarded on the client, so the PATCH arrived with lineItems: [] —
// and updateOrder deletes every line before it inserts, so pressing Save wiped the order and
// returned 200. Nothing was refused, nothing was reported, and the only thing on screen afterwards
// was an order with no items.
//
// That is exactly what a jeweller told us: "it stopped saving the item information, such as the
// bracelet quality and price, no matter how many times we enter it." Three saves, three silent
// wipes, no message. It became reachable the day the form grew a Piece type dropdown — with
// somewhere to say "Bracelet", there was less reason to also type a name.
//
// So the filter stays (a genuinely blank row is not an item) and the SILENCE goes.

/**
 * True when somebody has put anything into this row other than its name.
 *
 * ARRAYS ARE HANDLED EXPLICITLY. This used to call `.trim()` on every value, which was safe only
 * while every field was a string. `sideStoneShapes` is an array, and the unguarded version would
 * throw on it — inside the guard that exists to stop a filled-in line being silently discarded,
 * which is the last place that can afford to break.
 */
export const lineHasContent = (l: LineDraft): boolean => {
  const blank = emptyLine()
  return (Object.keys(blank) as (keyof LineDraft)[]).some((k) => {
    if (k === 'productName') return false
    const v = l[k]
    return Array.isArray(v) ? v.length > 0 : v.trim() !== (blank[k] as string)
  })
}

/** 1-based positions of rows that would be dropped: filled in, but unnamed. */
export const namelessLines = (lines: LineDraft[]): number[] =>
  lines.reduce<number[]>((out, l, i) => (!l.productName.trim() && lineHasContent(l) ? [...out, i + 1] : out), [])

/** What to put on screen instead of saving. Null when there is nothing to say. */
export const namelessError = (lines: LineDraft[]): string | null => {
  const rows = namelessLines(lines)
  if (!rows.length) return null
  const which = rows.length === 1 ? `Item ${rows[0]} needs` : `Items ${rows.join(', ')} need`
  return `${which} a product name before this can be saved — everything else on ${rows.length === 1 ? 'that line' : 'those lines'} is filled in, and a line without a name cannot be stored.`
}


// A line item may carry a value that has since been retired from the list — an older order being edited.
// Keep showing it rather than silently blanking the field.
function OptionSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const all = value && !options.includes(value) ? [value, ...options] : options
  const id = `li-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <div className="v2-fld">
      <label htmlFor={id}>{label}</label>
      <span className="v2-sel">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {all.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </span>
    </div>
  )
}

/**
 * SEVERAL SHAPES ON ONE PIECE.
 *
 * A ring can be round-cut on the shoulders and baguette down the sides, and the single dropdown could
 * say one of those. What she did instead was write the second one into Notes, where the factory reads
 * it as prose and the document does not print it as a spec at all.
 *
 * ── CHECKBOXES, NOT A <select multiple> ─────────────────────────────────────────────────────────
 *
 * A native multi-select requires ctrl/cmd-click to add a second value and silently replaces the
 * selection on a plain click. On a touch screen it is worse. This is a small list she picks one or
 * two from, so every option is visible and each is one tap.
 *
 * A value retired from her list but still on this line is shown at the front, checked, exactly as
 * OptionSelect does — an old order being edited must not quietly lose a shape.
 */
function MultiOptionSelect({ label, values, options, onChange }: {
  label: string; values: string[]; options: string[]; onChange: (v: string[]) => void
}) {
  const all = [...values.filter((v) => !options.includes(v)), ...options]
  const toggle = (o: string) =>
    onChange(values.includes(o) ? values.filter((v) => v !== o) : [...values, o])

  return (
    <div className="v2-fld" style={{ gridColumn: '1 / -1' }}>
      <label>{label}</label>
      {all.length === 0
        ? <p className="v2-hint">No shapes in your list yet — add them in Settings.</p>
        : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 2 }}>
            {all.map((o) => {
              const on = values.includes(o)
              return (
                <button
                  key={o} type="button" onClick={() => toggle(o)}
                  aria-pressed={on}
                  className="v2-act"
                  data-solid={on || undefined}
                  style={{ fontSize: 12 }}
                >
                  {o}
                </button>
              )
            })}
          </div>
        )}
      {/* The order is the order she tapped them in, and it is the order they print. Said once, here,
          because nothing else on the form has an order that matters. */}
      {values.length > 1 && <p className="v2-hint" style={{ marginTop: 6 }}>Printed in the order you picked them.</p>}
    </div>
  )
}

export function LineItemFields({ line, lists, currencySymbol, onChange }: {
  line: LineDraft
  lists: OrderOptionList[]
  currencySymbol: string
  onChange: (k: keyof LineDraft, v: string | string[]) => void
}) {
  // Empty array when a list hasn't loaded yet — the field still renders, just with no choices.
  const opts = (key: string) => lists.find((l) => l.key === key)?.options.map((o) => o.label) ?? []

  // WHAT THIS LINE READS AS. Her pick if she has made one, else what the name says — so the eighteen
  // lines that predate the field are laid out correctly the first time she opens one, instead of
  // showing a tennis necklace's total under "Center weight" until somebody re-picks all of them.
  const typeKey = effectiveProductType({ productType: line.productType, productName: line.productName })
  // Said out loud, and only when it was actually read rather than chosen. A form that quietly
  // rearranged itself would be worse than one that asks.
  const readAs = !line.productType.trim() && typeKey !== 'unspecified' ? PRODUCT_TYPE_LABEL[typeKey] : null

  /** The spec for one variable field, or null when this piece does not have it AND it is empty. */
  const spec = (f: VariableField, value: string) => fieldFor(typeKey, f, value.trim() !== '')
  const typeOptions = opts(PRODUCT_TYPE_LIST_KEY)
  const lengthOpts = opts(LENGTH_LIST_KEY)

  return (
    <div className="space-y-5">
      <div className="v2-form" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {/* NAMED AS REQUIRED, because it is: a row without one is dropped, and the only signal used
            to be the item vanishing after Save. */}
        <div className="v2-fld">
          <label htmlFor="li-product">Product <span style={{ color: 'var(--v2-red-ink)' }} aria-hidden>*</span></label>
          <input id="li-product" value={line.productName} onChange={(e) => onChange('productName', e.target.value)} required aria-required />
        </div>
        {/* The type list is HERS — she adds "Anklet" in Settings and it appears here, showing every
            field until somebody describes what an anklet needs.
            AND IT ONLY RENDERS IF SHE HAS ONE. A tenant who has not taken the jewellery starter, or
            whose database has not had add_order_product_types run yet, would otherwise get a "Piece
            type" dropdown whose only entry is the empty one — a control that cannot be used, offered
            to everybody, for as long as a hand-run migration takes. */}
        {typeOptions.length > 0 && (
          <div>
            <OptionSelect label="Piece type" value={line.productType} options={typeOptions} onChange={(v) => onChange('productType', v)} />
            {readAs && <p className="v2-hint" style={{ marginTop: 4 }}>Read as {readAs} from the name. Pick one to be sure.</p>}
          </div>
        )}
        <div className="v2-fld"><label htmlFor="li-sku">SKU</label><input id="li-sku" value={line.sku} onChange={(e) => onChange('sku', e.target.value)} /></div>
        <div className="v2-fld"><label htmlFor="li-qty">Qty</label><input id="li-qty" value={line.quantity} onChange={(e) => onChange('quantity', e.target.value)} /></div>
        <div className="v2-fld"><label htmlFor="li-price">Unit price ({currencySymbol})</label><input id="li-price" value={line.unitPrice} onChange={(e) => onChange('unitPrice', e.target.value)} placeholder="0" /></div>
        {/* INTERNAL. Labelled on the input itself, because the one thing that must never happen is
            somebody typing a cost into a field they believe the customer will see. It appears on no
            document, share link, approval page, email or PDF — asserted in
            lib/orders/internal-cost.test.ts. */}
        {/* The one field on this form the customer must never see, so it is the one field marked.
            A chip rather than an amber label: amber text on an amber label beside eleven grey ones
            was the loudest thing in the group and still did not say WHY it was different. */}
        <div className="v2-fld">
          <label htmlFor="li-cost">
            Internal cost ({currencySymbol})
            <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t4)', marginLeft: 8 }}>your team only</span>
          </label>
          <input id="li-cost" value={line.internalCost} onChange={(e) => onChange('internalCost', e.target.value)} placeholder="—" />
        </div>
      </div>

      {/* The stone group. A grey filled box inside a card was a surface inside a surface; the group
          is a labelled rule now, which is what every other grouping in this language is. */}
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="v2-kick" style={{ marginBottom: 10 }}>Stone</legend>
        <div className="v2-form" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <OptionSelect label="Type" value={line.stoneType} options={opts('stone_type')} onChange={(v) => onChange('stoneType', v)} />
          <OptionSelect label="Natural / Lab Grown" value={line.stoneOrigin} options={opts('stone_origin')} onChange={(v) => onChange('stoneOrigin', v)} />
          <OptionSelect label="Quality" value={line.stoneQuality} options={opts('stone_quality')} onChange={(v) => onChange('stoneQuality', v)} />
          <OptionSelect label="Colour" value={line.stoneColor} options={opts('stone_color')} onChange={(v) => onChange('stoneColor', v)} />
          {/* Named for the piece: "Center weight" on a ring, "Total weight" on a tennis necklace, and
              the same column underneath both — so her 17ct never moves. A field this piece does not
              have but the line already holds a value in comes back anyway, under its plain name,
              because nothing she typed may disappear off the screen while staying in the database. */}
          {(() => { const f = spec('centerStoneShape', line.centerStoneShape); return f && (
            <OptionSelect label={f.label} value={line.centerStoneShape} options={opts('center_stone_shape')} onChange={(v) => onChange('centerStoneShape', v)} />
          ) })()}
          {(() => { const f = spec('centerStoneCarat', line.centerStoneCarat); return f && (
            <div className="v2-fld"><label htmlFor="li-centerStoneCarat">{f.label}</label><input id="li-centerStoneCarat" value={line.centerStoneCarat} onChange={(e) => onChange('centerStoneCarat', e.target.value)} inputMode="decimal" placeholder="e.g. 1.25" /></div>
          ) })()}
          {/* Plural now. `spec` is still asked about the singular field because that is what the
              per-piece field set is keyed on — what changed is how many of them a line may hold, not
              which pieces have side stones at all. */}
          {(() => { const f = spec('sideStoneShape', line.sideStoneShapes[0] ?? ''); return f && (
            <MultiOptionSelect label={`${f.label}s`} values={line.sideStoneShapes} options={opts('side_stone_shape')} onChange={(v) => onChange('sideStoneShapes', v)} />
          ) })()}
          {(() => { const f = spec('sideStoneCaratTotal', line.sideStoneCaratTotal); return f && (
            <div className="v2-fld"><label htmlFor="li-sideStoneCaratTotal">{f.label}</label><input id="li-sideStoneCaratTotal" value={line.sideStoneCaratTotal} onChange={(e) => onChange('sideStoneCaratTotal', e.target.value)} inputMode="decimal" placeholder="e.g. 0.50" /></div>
          ) })()}
          {/* The lab that graded the stone — it belongs with the stone, not with the metal. */}
          <OptionSelect label="Certificate lab" value={line.certificateLab} options={opts('certificate_lab')} onChange={(v) => onChange('certificateLab', v)} />
        </div>
      </fieldset>

      <div className="v2-form" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <OptionSelect label="Gold karat / metal" value={line.metalKarat} options={opts('metal_karat')} onChange={(v) => onChange('metalKarat', v)} />
        {/* Ring size is its own field, not free text: a mistyped size is a remake. It is offered on the
            things worn on a finger, and on anything else only if a value is already sitting in it. */}
        {(() => { const f = spec('ringSize', line.ringSize); return f && (
          <OptionSelect label={f.label} value={line.ringSize} options={opts('ring_size')} onChange={(v) => onChange('ringSize', v)} />
        ) })()}
        {/* ONE column, three quantities — her own rows prove it: stone dimensions (10X7.5X4), band
            width (2.00mm) and length (16''). So it is named for the piece, and on a necklace or a
            bracelet it becomes a dropdown off her Length list rather than free text, for the same
            reason ring size is one. No list yet, and it stays exactly the text box it was. */}
        {(() => {
          const f = spec('measurements', line.measurements)
          if (!f) return null
          return f.list === LENGTH_LIST_KEY && lengthOpts.length > 0
            ? <OptionSelect label={f.label} value={line.measurements} options={lengthOpts} onChange={(v) => onChange('measurements', v)} />
            : <div className="v2-fld"><label htmlFor="li-measurements">{f.label}</label><input id="li-measurements" value={line.measurements} onChange={(e) => onChange('measurements', e.target.value)} /></div>
        })()}
        {/* Its own numeric field with a fixed unit, rather than another thing crammed into
            Measurements — see lib/orders/product-types.ts. Offered on the pieces worn on a finger,
            and anywhere else only when a value is already sitting in it. */}
        {(() => { const f = spec('bandWidthMm', line.bandWidthMm); return f && (
          <div className="v2-fld"><label htmlFor="li-bandWidthMm">{f.label}</label><input id="li-bandWidthMm" value={line.bandWidthMm} onChange={(e) => onChange('bandWidthMm', e.target.value)} inputMode="decimal" placeholder="e.g. 2.00" /></div>
        ) })()}
        <div className="v2-fld"><label htmlFor="li-color">Finish / colour note</label><input id="li-color" value={line.color} onChange={(e) => onChange('color', e.target.value)} /></div>
        <div className="v2-fld"><label htmlFor="li-customSpec">Custom spec</label><input id="li-customSpec" value={line.customSpec} onChange={(e) => onChange('customSpec', e.target.value)} /></div>
      </div>

      <div className="v2-fld"><label htmlFor="li-description">Description</label><input id="li-description" value={line.description} onChange={(e) => onChange('description', e.target.value)} /></div>
    </div>
  )
}

// Shared loader so both the create form and the edit dialog fetch the tenant's lists the same way.
export async function fetchOptionLists(): Promise<OrderOptionList[]> {
  try {
    const r = await fetch('/api/orders/options')
    if (!r.ok) return []
    return (await r.json()).lists ?? []
  } catch { return [] }
}
