'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Search, Plus, Check, Tag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer } from '@/components/ui/drawer'
import { Skeleton } from '@/components/ui/skeleton'
import { filterCategories, groupCategories, type CategoryLite } from '@/lib/core/category-util'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Category extends CategoryLite { id: string }

// Searchable, tenant-managed category picker with inline "Add category". Vertical-agnostic — options come
// only from /api/core/categories (seeded by the installed package + tenant-created). Keyboard-friendly,
// mobile-safe (drawer). Writes the category NAME (compatible with the existing text column).
export function CategorySelect({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => setOpen(true)} className="flex h-11 flex-1 items-center justify-between rounded-input border border-hairline bg-white px-3 text-left text-sm text-ink focus:border-ink/30 focus:outline-none">
        <span className={cn('truncate', !value && 'text-muted')}>{value || 'Select category'}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
      </button>
      {open && <CategoryPicker value={value} onClose={() => setOpen(false)} onPick={(n) => { onChange(n); setOpen(false) }} />}
    </div>
  )
}

function CategoryPicker({ value, onClose, onPick }: { value: string; onClose: () => void; onPick: (name: string) => void }) {
  const [cats, setCats] = useState<Category[] | null>(null)
  const [q, setQ] = useState('')
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)

  const load = () => fetch('/api/core/categories').then((r) => r.json()).then((d) => setCats(d.categories ?? [])).catch(() => setCats([]))
  useEffect(() => { load() }, [])

  // include the current value even if it's a legacy free-text category not in the managed list
  const withCurrent = useMemo(() => {
    if (!cats) return null
    if (value && !cats.some((c) => c.name === value)) return [{ id: '__current__', name: value, group_label: null, sort_order: -1, archived_at: null } as Category, ...cats]
    return cats
  }, [cats, value])

  const groups = useMemo(() => withCurrent ? groupCategories(filterCategories(withCurrent, q)) : [], [withCurrent, q])
  const flat = groups.flatMap((g) => g.items)

  async function addCategory() {
    const name = newName.trim()
    if (!name) { toast.error('Enter a category name.'); return }
    setAdding(true)
    const res = await fetch('/api/core/categories', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
    const d = await res.json().catch(() => ({}))
    setAdding(false)
    if (res.ok && d.ok) { toast.success('Category added.'); onPick(d.category.name) }
    else toast.error(d.error === 'duplicate' ? 'That category already exists.' : 'Could not add the category.')
  }

  return (
    <Drawer open onClose={onClose} title="Choose category"
      footer={<div className="flex items-center gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCategory() }} placeholder="New category name" className="h-10 flex-1 rounded-input border border-hairline bg-white px-3 text-sm text-ink placeholder:text-muted focus:border-ink/30 focus:outline-none" />
        <Button size="sm" loading={adding} onClick={addCategory}><Plus className="h-4 w-4" /> Add</Button>
      </div>}>
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && flat[0]) onPick(flat[0].name) }} autoFocus placeholder="Search categories…" className="h-11 w-full rounded-input border border-hairline bg-white pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:border-ink/30 focus:outline-none" />
        </div>
        {value && <button onClick={() => onPick('')} className="text-xs text-subtle hover:text-ink">Clear category</button>}
        {!withCurrent ? <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          : flat.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/10 text-accent-strong"><Tag className="h-5 w-5" /></span>
              <p className="text-sm text-muted">{q ? 'No categories match.' : 'No categories yet — add one below or install a package.'}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => (
                <div key={g.group ?? '__ungrouped__'}>
                  {g.group && <p className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-muted">{g.group}</p>}
                  <ul className="space-y-0.5">
                    {g.items.map((c) => (
                      <li key={c.id}>
                        <button onClick={() => onPick(c.name)} className={cn('flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-sunken', c.name === value && 'bg-accent/5')}>
                          <span className="truncate text-ink">{c.name}</span>
                          {c.name === value && <Check className="h-4 w-4 shrink-0 text-accent-strong" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
      </div>
    </Drawer>
  )
}
