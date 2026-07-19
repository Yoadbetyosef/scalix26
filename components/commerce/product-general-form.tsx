'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { PRODUCT_STATUSES } from '@/lib/core/product-input'
import { CategorySelect } from '@/components/commerce/category-select'
import { ImageField } from '@/components/commerce/image-field'
import { toast } from 'sonner'

// Typed Core product fields only — NO vertical fields here (those render on the Attributes tab from
// field_definitions). Reused by create and edit; the parent supplies onSubmit (POST vs PATCH).
export interface GeneralValues { name: string; sku: string; category: string; brand: string; price: string; status: string; description: string; image_url: string }
type Initial = Partial<{ name: string; sku: string | null; category: string | null; brand: string | null; price: number | null; status: string; description: string | null; image_url: string | null }>

const str = (v: string | null | undefined) => v ?? ''

export function ProductGeneralForm({ initial, submitLabel, onSubmit }: {
  initial?: Initial; submitLabel: string
  onSubmit: (payload: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>
}) {
  const [v, setV] = useState<GeneralValues>({
    name: str(initial?.name), sku: str(initial?.sku), category: str(initial?.category), brand: str(initial?.brand),
    price: initial?.price != null ? String(initial.price) : '', status: initial?.status ?? 'active',
    description: str(initial?.description), image_url: str(initial?.image_url),
  })
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof GeneralValues>(k: K, val: string) => setV((p) => ({ ...p, [k]: val }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!v.name.trim()) { toast.error('Name is required.'); return }
    let price: number | null = null
    if (v.price.trim()) { const n = Number(v.price); if (!Number.isFinite(n) || n < 0) { toast.error('Enter a valid price.'); return } price = n }
    setSaving(true)
    const payload = {
      name: v.name.trim(), sku: v.sku.trim() || null, category: v.category.trim() || null, brand: v.brand.trim() || null,
      price, status: v.status, description: v.description.trim() || null, image_url: v.image_url.trim() || null,
    }
    const r = await onSubmit(payload)
    setSaving(false)
    if (!r.ok) toast.error(r.error || 'Could not save the product.')
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5">
      <Field label="Name" required><Input value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="Product name" maxLength={300} /></Field>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="SKU"><Input value={v.sku} onChange={(e) => set('sku', e.target.value)} placeholder="Optional" maxLength={120} /></Field>
        <Field label="Category"><CategorySelect value={v.category} onChange={(name) => set('category', name)} /></Field>
        <Field label="Brand"><Input value={v.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Optional" maxLength={120} /></Field>
        <Field label="Base price (USD)">
          <Input value={v.price} onChange={(e) => set('price', e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" />
        </Field>
        <Field label="Status">
          <select value={v.status} onChange={(e) => set('status', e.target.value)} className="h-11 w-full rounded-input border border-hairline bg-white px-3 text-sm text-ink focus:border-ink/30 focus:outline-none">
            {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Product image"><ImageField value={v.image_url} onChange={(url) => set('image_url', url)} /></Field>
      <Field label="Description"><Textarea value={v.description} onChange={(e) => set('description', e.target.value)} rows={4} placeholder="Optional" maxLength={5000} /></Field>
      <div className="flex justify-end">
        <Button type="submit" loading={saving}>{submitLabel}</Button>
      </div>
    </form>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}{required && <span className="text-danger"> *</span>}</Label>
      {children}
    </div>
  )
}
