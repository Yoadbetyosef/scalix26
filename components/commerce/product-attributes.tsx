'use client'

import { useEffect, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { FieldControl, initialFieldState, coerceFieldValue, type FieldDef, type FieldState } from '@/components/commerce/field-renderer'
import { toast } from 'sonner'

// Vertical attributes for a product. The fields shown come ENTIRELY from field_definitions (installed via a
// schema package or authored by the tenant) — no field is hard-coded here. A jewelry tenant sees jewelry
// fields; a furniture tenant sees furniture fields; a tenant with no package sees the install prompt.
export function ProductAttributes({ productId }: { productId: string }) {
  const [defs, setDefs] = useState<FieldDef[] | null>(null)
  const [state, setState] = useState<Record<string, FieldState>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    fetch(`/api/core/products/${productId}/attributes`)
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
  }, [productId])

  async function save() {
    if (!defs) return
    const values: Record<string, unknown> = {}
    for (const def of defs) {
      const c = coerceFieldValue(def, state[def.key] ?? '')
      if (!c.ok) { toast.error(c.error); return }
      values[def.key] = c.value
    }
    setSaving(true)
    const res = await fetch(`/api/core/products/${productId}/attributes`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values }) })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.ok && d.ok) toast.success('Attributes saved.')
    else toast.error((d.errors && d.errors[0]) || 'Could not save attributes.')
  }

  if (!defs) return <div className="max-w-2xl space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>

  if (defs.length === 0) return (
    <EmptyState icon={SlidersHorizontal} title="No attributes for this product type yet">
      Attributes are the industry-specific details for your products. Install a package or add custom fields in
      Settings to start capturing them — nothing is hard-coded.
    </EmptyState>
  )

  return (
    <div className="max-w-2xl">
      <p className="mb-4 text-sm text-muted">Industry-specific details for this product. These fields come from your installed package and custom fields.</p>
      <div className="space-y-5">
        {defs.map((def) => (
          <FieldControl key={def.id} def={def} value={state[def.key] ?? ''} onChange={(v) => setState((p) => ({ ...p, [def.key]: v }))} />
        ))}
      </div>
      <div className="mt-6 flex justify-end"><Button loading={saving} onClick={save}>Save attributes</Button></div>
    </div>
  )
}
