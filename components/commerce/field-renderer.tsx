'use client'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { type FieldDef, type FieldState } from '@/lib/core/field-ui'

// Reusable, VERTICAL-AGNOSTIC attribute renderer. Renders any field_definitions row across all 18 types.
// Zero hard-coded vertical logic — furniture/jewelry fields appear only because a package installed them.
// Pure state/coercion helpers live in lib/core/field-ui (re-exported here for callers).
export { initialFieldState, coerceFieldValue } from '@/lib/core/field-ui'
export type { FieldDef, FieldState } from '@/lib/core/field-ui'

export function FieldControl({ def, value, onChange }: { def: FieldDef; value: FieldState; onChange: (v: FieldState) => void }) {
  const help = typeof def.validation?.help === 'string' ? (def.validation.help as string) : null
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label>{def.label}{def.required && <span className="text-danger"> *</span>}</Label>
        {def.source_package_id
          ? <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-strong">Package</span>
          : <span className="rounded-full bg-sunken px-1.5 py-0.5 text-[10px] font-medium text-muted">Custom</span>}
      </div>
      <Control def={def} value={value} onChange={onChange} />
      {help && <p className="text-xs text-muted">{help}</p>}
    </div>
  )
}

function Control({ def, value, onChange }: { def: FieldDef; value: FieldState; onChange: (v: FieldState) => void }) {
  const s = typeof value === 'string' ? value : ''
  switch (def.field_type) {
    case 'long_text':
      return <Textarea value={s} onChange={(e) => onChange(e.target.value)} rows={3} />
    case 'boolean':
      return <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" /> Yes</label>
    case 'integer':
      return <Input value={s} onChange={(e) => onChange(e.target.value)} type="number" step="1" inputMode="numeric" />
    case 'decimal':
      return <Input value={s} onChange={(e) => onChange(e.target.value)} type="number" step="any" inputMode="decimal" />
    case 'money':
      return <Input value={s} onChange={(e) => onChange(e.target.value)} type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" />
    case 'date':
      return <Input value={s} onChange={(e) => onChange(e.target.value)} type="date" />
    case 'datetime':
      return <Input value={s} onChange={(e) => onChange(e.target.value)} type="datetime-local" />
    case 'select':
      return (
        <select value={s} onChange={(e) => onChange(e.target.value)} className="h-11 w-full rounded-input border border-hairline bg-white px-3 text-sm text-ink focus:border-ink/30 focus:outline-none">
          <option value="">—</option>
          {(def.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    case 'multi_select': {
      const arr = Array.isArray(value) ? value : []
      return (
        <div className="flex flex-wrap gap-2">
          {(def.options ?? []).map((o) => {
            const on = arr.includes(o.value)
            return (
              <button key={o.value} type="button" onClick={() => onChange(on ? arr.filter((x) => x !== o.value) : [...arr, o.value])}
                className={on ? 'rounded-full border border-accent bg-accent/10 px-3 py-1 text-sm text-accent-strong' : 'rounded-full border border-hairline px-3 py-1 text-sm text-subtle hover:border-ink/30'}>
                {o.label}
              </button>
            )
          })}
        </div>
      )
    }
    default: // text, file, image, *_relation — plain value input (relation pickers land later)
      return <Input value={s} onChange={(e) => onChange(e.target.value)} placeholder={def.field_type.endsWith('_relation') ? 'Record ID' : def.field_type === 'image' || def.field_type === 'file' ? 'https://…' : ''} />
  }
}
