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
    <div>
      {/* Three cascading selects in the form language: a rule under each, the chevron drawn rather
          than left to the platform, and a disabled one greyed by the field itself. */}
      <div className="v2-form" data-cols="3">
        <div className="v2-fld">
          <label htmlFor="fab-cat">Category</label>
          <span className="v2-sel">
            <select id="fab-cat" value={value.fabric_category || ''} onChange={(e) => setCategory(e.target.value)}>
              <option value="">— None —</option>
              {FABRIC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </span>
        </div>
        <div className="v2-fld">
          <label htmlFor="fab-fam">Fabric</label>
          <span className="v2-sel">
            <select id="fab-fam" disabled={!value.fabric_category} value={value.fabric_family || ''} onChange={(e) => setFamily(e.target.value)}>
              <option value="">— Select —</option>
              {families.map((f) => <option key={f.family} value={f.family}>{f.family}</option>)}
            </select>
          </span>
        </div>
        <div className="v2-fld">
          <label htmlFor="fab-col">Colour</label>
          <span className="v2-sel">
            <select id="fab-col" disabled={!value.fabric_family} value={value.fabric_name || ''} onChange={(e) => setColor(e.target.value)}>
              <option value="">— Select —</option>
              {colors.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
            </select>
          </span>
        </div>
      </div>
      {value.fabric_name && (value.fabric_composition || value.fabric_durability) && (
        <p className="v2-hint" style={{ marginTop: 12 }}>
          {[value.fabric_composition, value.fabric_durability].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  )
}
