'use client'

import { FABRIC_CATEGORIES, familiesOf, colorsOf, findFabric } from '@/lib/studio/fabrics'

export interface FabricValue {
  fabric_category: string | null
  fabric_family: string | null
  fabric_name: string | null
  fabric_composition: string | null
  fabric_durability: string | null
}

export const EMPTY_FABRIC: FabricValue = {
  fabric_category: null, fabric_family: null, fabric_name: null, fabric_composition: null, fabric_durability: null,
}

const sel = 'h-11 w-full rounded-lg border border-hairline-strong bg-white px-3 text-sm outline-none focus:border-accent disabled:opacity-50'

// Cascading fabric selection: category → family → colour. Composition + durability auto-fill from the
// chosen colour and are shown read-only. Emits the full FabricValue on every change.
export function FabricPicker({ value, onChange }: { value: FabricValue; onChange: (v: FabricValue) => void }) {
  const families = value.fabric_category ? familiesOf(value.fabric_category) : []
  const colors = value.fabric_category && value.fabric_family ? colorsOf(value.fabric_category, value.fabric_family) : []

  const setCategory = (c: string) => onChange({ ...EMPTY_FABRIC, fabric_category: c || null })
  const setFamily = (f: string) => onChange({ ...EMPTY_FABRIC, fabric_category: value.fabric_category, fabric_family: f || null })
  const setColor = (name: string) => {
    const hit = findFabric(name)
    onChange({
      fabric_category: value.fabric_category, fabric_family: value.fabric_family,
      fabric_name: name || null,
      fabric_composition: hit?.composition ?? null,
      fabric_durability: hit?.durability ?? null,
    })
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Category</span>
          <select className={sel} value={value.fabric_category || ''} onChange={(e) => setCategory(e.target.value)}>
            <option value="">— None —</option>
            {FABRIC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Fabric</span>
          <select className={sel} disabled={!value.fabric_category} value={value.fabric_family || ''} onChange={(e) => setFamily(e.target.value)}>
            <option value="">— Select —</option>
            {families.map((f) => <option key={f.family} value={f.family}>{f.family}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Colour</span>
          <select className={sel} disabled={!value.fabric_family} value={value.fabric_name || ''} onChange={(e) => setColor(e.target.value)}>
            <option value="">— Select —</option>
            {colors.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
          </select>
        </label>
      </div>
      {value.fabric_name && (value.fabric_composition || value.fabric_durability) && (
        <p className="text-xs text-muted">
          {[value.fabric_composition, value.fabric_durability].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  )
}
