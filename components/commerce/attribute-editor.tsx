'use client'

import { useEffect, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { FieldControl, initialFieldState, coerceFieldValue, type FieldDef, type FieldState } from '@/components/commerce/field-renderer'
import { toast } from 'sonner'

// Reusable dynamic attribute editor for ANY scope (product / variant / component / …). Fields come entirely
// from field_definitions via the given endpoint (GET → {definitions, values}, PATCH → {values}). No vertical
// hard-coding; server re-validates every value; ordering/required/options/help/package-badges all handled.
export function AttributeEditor({ endpoint, emptyHint }: { endpoint: string; emptyHint?: string }) {
  const [defs, setDefs] = useState<FieldDef[] | null>(null)
  const [state, setState] = useState<Record<string, FieldState>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    fetch(endpoint)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('load'))))
      .then((d: { definitions: FieldDef[]; values: Record<string, unknown> }) => {
        if (!live) return
        setDefs(d.definitions)
        const init: Record<string, FieldState> = {}
        for (const def of d.definitions) init[def.key] = initialFieldState(def, d.values[def.key])
        setState(init)
      })
      .catch(() => { if (live) setDefs([]) })
    return () => { live = false }
  }, [endpoint])

  async function save() {
    if (!defs) return
    const values: Record<string, unknown> = {}
    for (const def of defs) {
      const c = coerceFieldValue(def, state[def.key] ?? '')
      if (!c.ok) { toast.error(c.error); return }
      // client-side required guard (server re-validates authoritatively)
      if (def.required && (c.value == null || c.value === '' || (Array.isArray(c.value) && c.value.length === 0))) { toast.error(`${def.label} is required.`); return }
      values[def.key] = c.value
    }
    setSaving(true)
    const res = await fetch(endpoint, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values }) })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.ok && d.ok) toast.success('Attributes saved.')
    else toast.error((d.errors && d.errors[0]) || 'Could not save attributes.')
  }

  if (!defs) return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>

  if (defs.length === 0) return (
    <EmptyState icon={SlidersHorizontal} title="No attributes for this type yet">
      {emptyHint || 'Attributes come from your installed package or custom fields — add them in Settings. Nothing is hard-coded.'}
    </EmptyState>
  )

  return (
    <div>
      <div className="space-y-5">
        {defs.map((def) => (
          <FieldControl key={def.id} def={def} value={state[def.key] ?? ''} onChange={(v) => setState((p) => ({ ...p, [def.key]: v }))} />
        ))}
      </div>
      <div className="mt-6 flex justify-end"><Button loading={saving} onClick={save}>Save attributes</Button></div>
    </div>
  )
}
