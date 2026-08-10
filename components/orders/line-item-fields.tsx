'use client'

import type { OrderOptionList } from '@/lib/orders/options'

// The line-item editor, shared by the create form and the edit dialog so the two can never drift.
// Jewelry attributes come from the tenant's own dropdown lists; carats are free numeric entry.

export interface LineDraft {
  productName: string; description: string; sku: string; quantity: string; unitPrice: string; internalCost: string
  measurements: string; color: string; material: string; customSpec: string
  stoneType: string; stoneOrigin: string; stoneQuality: string; stoneColor: string
  centerStoneShape: string; sideStoneShape: string; metalKarat: string
  centerStoneCarat: string; sideStoneCaratTotal: string
  certificateLab: string; ringSize: string
}

export const emptyLine = (): LineDraft => ({
  productName: '', description: '', sku: '', quantity: '1', unitPrice: '', internalCost: '',
  measurements: '', color: '', material: '', customSpec: '',
  stoneType: '', stoneOrigin: '', stoneQuality: '', stoneColor: '',
  centerStoneShape: '', sideStoneShape: '', metalKarat: '',
  centerStoneCarat: '', sideStoneCaratTotal: '',
  certificateLab: '', ringSize: '',
})

// Turn the on-screen strings into the API payload. Blank means "not specified", never 0 or "".
export const lineToPayload = (l: LineDraft) => ({
  productName: l.productName, description: l.description || null, sku: l.sku || null,
  quantity: parseFloat(l.quantity) || 1, unitPriceCents: Math.round((parseFloat(l.unitPrice) || 0) * 100),
  // Empty stays NULL — "not recorded" — rather than becoming 0, which would claim the line was free.
  internalCostCents: l.internalCost.trim() === '' ? null : Math.round((parseFloat(l.internalCost) || 0) * 100),
  measurements: l.measurements || null, color: l.color || null, material: l.material || null, customSpec: l.customSpec || null,
  stoneType: l.stoneType || null, stoneOrigin: l.stoneOrigin || null, stoneQuality: l.stoneQuality || null, stoneColor: l.stoneColor || null,
  centerStoneShape: l.centerStoneShape || null, sideStoneShape: l.sideStoneShape || null, metalKarat: l.metalKarat || null,
  certificateLab: l.certificateLab || null, ringSize: l.ringSize || null,
  centerStoneCarat: l.centerStoneCarat.trim() === '' ? null : parseFloat(l.centerStoneCarat),
  sideStoneCaratTotal: l.sideStoneCaratTotal.trim() === '' ? null : parseFloat(l.sideStoneCaratTotal),
})

// Rehydrate a saved line item back into the form.
export const lineFromSaved = (l: {
  productName: string; description: string | null; sku: string | null; quantity: number; unitPriceCents: number
  internalCostCents?: number | null
  measurements: string | null; color: string | null; material: string | null; customSpec: string | null
  stoneType?: string | null; stoneOrigin?: string | null; stoneQuality?: string | null; stoneColor?: string | null
  centerStoneShape?: string | null; sideStoneShape?: string | null; metalKarat?: string | null
  centerStoneCarat?: number | null; sideStoneCaratTotal?: number | null
  certificateLab?: string | null; ringSize?: string | null
}): LineDraft => ({
  productName: l.productName, description: l.description ?? '', sku: l.sku ?? '',
  quantity: String(l.quantity), unitPrice: l.unitPriceCents ? (l.unitPriceCents / 100).toString() : '',
  internalCost: l.internalCostCents === null || l.internalCostCents === undefined ? '' : (l.internalCostCents / 100).toString(),
  measurements: l.measurements ?? '', color: l.color ?? '', material: l.material ?? '', customSpec: l.customSpec ?? '',
  stoneType: l.stoneType ?? '', stoneOrigin: l.stoneOrigin ?? '', stoneQuality: l.stoneQuality ?? '', stoneColor: l.stoneColor ?? '',
  centerStoneShape: l.centerStoneShape ?? '', sideStoneShape: l.sideStoneShape ?? '', metalKarat: l.metalKarat ?? '',
  centerStoneCarat: l.centerStoneCarat == null ? '' : String(l.centerStoneCarat),
  sideStoneCaratTotal: l.sideStoneCaratTotal == null ? '' : String(l.sideStoneCaratTotal),
  certificateLab: l.certificateLab ?? '', ringSize: l.ringSize ?? '',
})

const inp = 'mt-0.5 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm'

// A line item may carry a value that has since been retired from the list — an older order being edited.
// Keep showing it rather than silently blanking the field.
function OptionSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const all = value && !options.includes(value) ? [value, ...options] : options
  return (
    <label className="block text-xs text-gray-500">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inp}>
        <option value="">—</option>
        {all.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

export function LineItemFields({ line, lists, currencySymbol, onChange }: {
  line: LineDraft
  lists: OrderOptionList[]
  currencySymbol: string
  onChange: (k: keyof LineDraft, v: string) => void
}) {
  // Empty array when a list hasn't loaded yet — the field still renders, just with no choices.
  const opts = (key: string) => lists.find((l) => l.key === key)?.options.map((o) => o.label) ?? []

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="block text-xs text-gray-500">Product<input value={line.productName} onChange={(e) => onChange('productName', e.target.value)} className={inp} /></label>
        <label className="block text-xs text-gray-500">SKU<input value={line.sku} onChange={(e) => onChange('sku', e.target.value)} className={inp} /></label>
        <label className="block text-xs text-gray-500">Qty<input value={line.quantity} onChange={(e) => onChange('quantity', e.target.value)} className={inp} /></label>
        <label className="block text-xs text-gray-500">Unit price ({currencySymbol})<input value={line.unitPrice} onChange={(e) => onChange('unitPrice', e.target.value)} placeholder="0" className={inp} /></label>
        {/* INTERNAL. Labelled on the input itself, because the one thing that must never happen is
            somebody typing a cost into a field they believe the customer will see. It appears on no
            document, share link, approval page, email or PDF — asserted in
            lib/orders/internal-cost.test.ts. */}
        <label className="block text-xs text-amber-700">
          Internal cost ({currencySymbol}) <span className="font-normal text-amber-600">· your team only</span>
          <input value={line.internalCost} onChange={(e) => onChange('internalCost', e.target.value)} placeholder="—" className={inp} />
        </label>
      </div>

      <fieldset className="rounded-lg bg-gray-50 p-3">
        <legend className="px-1 text-xs font-semibold text-gray-700">Stone</legend>
        <div className="grid gap-2 sm:grid-cols-4">
          <OptionSelect label="Type" value={line.stoneType} options={opts('stone_type')} onChange={(v) => onChange('stoneType', v)} />
          <OptionSelect label="Natural / Lab Grown" value={line.stoneOrigin} options={opts('stone_origin')} onChange={(v) => onChange('stoneOrigin', v)} />
          <OptionSelect label="Quality" value={line.stoneQuality} options={opts('stone_quality')} onChange={(v) => onChange('stoneQuality', v)} />
          <OptionSelect label="Colour" value={line.stoneColor} options={opts('stone_color')} onChange={(v) => onChange('stoneColor', v)} />
          <OptionSelect label="Center shape" value={line.centerStoneShape} options={opts('center_stone_shape')} onChange={(v) => onChange('centerStoneShape', v)} />
          <label className="block text-xs text-gray-500">Center weight (ct)<input value={line.centerStoneCarat} onChange={(e) => onChange('centerStoneCarat', e.target.value)} inputMode="decimal" placeholder="e.g. 1.25" className={inp} /></label>
          <OptionSelect label="Side shape" value={line.sideStoneShape} options={opts('side_stone_shape')} onChange={(v) => onChange('sideStoneShape', v)} />
          <label className="block text-xs text-gray-500">Side total weight (ct)<input value={line.sideStoneCaratTotal} onChange={(e) => onChange('sideStoneCaratTotal', e.target.value)} inputMode="decimal" placeholder="e.g. 0.50" className={inp} /></label>
          {/* The lab that graded the stone — it belongs with the stone, not with the metal. */}
          <OptionSelect label="Certificate lab" value={line.certificateLab} options={opts('certificate_lab')} onChange={(v) => onChange('certificateLab', v)} />
        </div>
      </fieldset>

      <div className="grid gap-2 sm:grid-cols-4">
        <OptionSelect label="Gold karat / metal" value={line.metalKarat} options={opts('metal_karat')} onChange={(v) => onChange('metalKarat', v)} />
        {/* Ring size is its own field, not free text: a mistyped size is a remake. Measurements stays
            for everything that isn't a ring — chain length, pendant dimensions. */}
        <OptionSelect label="Ring size" value={line.ringSize} options={opts('ring_size')} onChange={(v) => onChange('ringSize', v)} />
        <label className="block text-xs text-gray-500">Measurements / size<input value={line.measurements} onChange={(e) => onChange('measurements', e.target.value)} className={inp} /></label>
        <label className="block text-xs text-gray-500">Finish / colour note<input value={line.color} onChange={(e) => onChange('color', e.target.value)} className={inp} /></label>
        <label className="block text-xs text-gray-500">Custom spec<input value={line.customSpec} onChange={(e) => onChange('customSpec', e.target.value)} className={inp} /></label>
      </div>

      <label className="block text-xs text-gray-500">Description<input value={line.description} onChange={(e) => onChange('description', e.target.value)} className={inp} /></label>
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
