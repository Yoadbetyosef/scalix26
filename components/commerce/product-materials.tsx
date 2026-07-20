'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Image as ImageIcon, Check, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { MATERIAL_STATUS } from '@/components/commerce/materials-list'
import { useTerminology } from '@/lib/hooks/use-terminology'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Material { id: string; name: string; code: string | null; image_url: string | null; color: string | null; status: string }

// Available Fabrics for a product — pick which library materials this product offers. Only linked materials
// appear later in the proposal fabric selector.
export function ProductMaterials({ productId }: { productId: string }) {
  const { term } = useTerminology()
  const many = term('material', { plural: true, fallback: 'Materials' })
  const [all, setAll] = useState<Material[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [initial, setInitial] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([fetch('/api/core/materials').then((r) => r.json()), fetch(`/api/core/products/${productId}/materials`).then((r) => r.json())])
      .then(([a, b]) => { setAll(a.materials ?? []); const s = new Set<string>((b.materials ?? []).map((m: Material) => m.id)); setSelected(s); setInitial(new Set(s)) })
      .catch(() => setAll([]))
  }, [productId])

  const dirty = all ? (selected.size !== initial.size || [...selected].some((id) => !initial.has(id))) : false
  function toggle(id: string) { setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }) }
  async function save() {
    setSaving(true)
    const r = await fetch(`/api/core/products/${productId}/materials`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ materialIds: [...selected] }) })
    setSaving(false)
    if (r.ok) { setInitial(new Set(selected)); toast.success(`Available ${many.toLowerCase()} updated.`) } else toast.error('Could not save.')
  }

  if (!all) return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
  if (all.length === 0) return <EmptyState icon={Layers} title={`No ${many.toLowerCase()} in the library`} action={<Link href="/commerce/fabrics" className="text-sm font-medium text-accent-strong hover:underline">Open the {many.toLowerCase()} library →</Link>}>Add {many.toLowerCase()} to the library first, then attach them here.</EmptyState>

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-muted">Choose which {many.toLowerCase()} this product offers. Only these appear on proposals.</p>
        <Button size="sm" onClick={save} loading={saving} disabled={!dirty}><Check className="h-4 w-4" /> Save</Button>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {all.map((m) => {
          const on = selected.has(m.id); const st = MATERIAL_STATUS[m.status] ?? { label: m.status, variant: 'neutral' as const }
          return (
            <li key={m.id}>
              <button onClick={() => toggle(m.id)} className={cn('flex w-full items-center gap-3 rounded-card border p-2 text-left transition-colors', on ? 'border-accent bg-accent/5' : 'border-hairline bg-surface hover:bg-sunken/40')}>
                <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded border', on ? 'border-accent bg-accent text-white' : 'border-hairline-strong')}>{on && <Check className="h-3.5 w-3.5" />}</span>
                {m.image_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={m.image_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                  : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sunken text-muted"><ImageIcon className="h-4 w-4" /></span>}
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{m.name}</span><span className="block truncate text-xs text-muted">{[m.code, m.color].filter(Boolean).join(' · ') || '—'}</span></span>
                <Badge variant={st.variant}>{st.label}</Badge>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
