'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import type { ProductNameSuggestion } from '@/lib/catalog/product-names'

// Name field on Add Product: type and it narrows the tenant's own range; open it and browse the whole
// list grouped by category. Free text still works — a piece that isn't on the list yet must not be
// blocked — but picking from the list is the fast path, and it carries the category across so the two
// fields can't disagree.
//
// The list is fetched once and filtered in the browser: a few hundred names is nothing to hold, and it
// makes typing feel instant with no request per keystroke.

const LISTBOX_ID = 'catalog-product-name-list'

export function ProductNameField({ value, category, onChange, className }: {
  value: string
  category: string | null
  onChange: (patch: { name: string; category?: string | null }) => void
  className?: string
}) {
  const [all, setAll] = useState<ProductNameSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch('/api/catalog/product-names')
        if (!alive || !r.ok) return
        setAll((await r.json()).names ?? [])
      } catch { /* no list yet — the field stays plain free text */ }
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return all
    // Names that START with what was typed come first — that's what someone typing "ath" is after.
    const starts = all.filter((n) => n.name.toLowerCase().startsWith(q))
    const contains = all.filter((n) => !n.name.toLowerCase().startsWith(q) && n.name.toLowerCase().includes(q))
    return [...starts, ...contains]
  }, [all, value])

  // Category headings resolved up front rather than by mutating a variable while rendering.
  const rows = useMemo(
    () => matches.map((s, i) => ({ s, heading: i === 0 || matches[i - 1].category !== s.category ? s.category : null })),
    [matches],
  )

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const pick = (s: ProductNameSuggestion) => {
    onChange({ name: s.name, category: s.category ?? category })
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return }
    if (!open || !matches.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % matches.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + matches.length) % matches.length) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(matches[active]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={box} className="relative">
      <div className="relative">
        <input
          className={className}
          required
          value={value}
          onChange={(e) => { onChange({ name: e.target.value }); setOpen(true); setActive(0) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={all.length ? 'Start typing, or open the list' : 'e.g. Neomi Sofa'}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
        />
        {all.length > 0 && (
          <button
            type="button" tabIndex={-1}
            onClick={() => { setOpen((o) => !o); setActive(0) }}
            aria-label="Show all products"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
          ><ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} /></button>
        )}
      </div>

      {open && all.length > 0 && (
        <ul ref={listRef} id={LISTBOX_ID} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {matches.length === 0 && (
            <li className="px-3 py-2 text-sm text-gray-500">
              Nothing matches — <span className="font-medium text-gray-700">{value}</span> will be added as a new product name.
            </li>
          )}
          {rows.map(({ s, heading }, i) => {
            return (
              <li key={s.id}>
                {heading && <div className="sticky top-0 bg-gray-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{heading}</div>}
                <button
                  type="button"
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(s)}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm ${i === active ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
                >
                  <span className="capitalize text-gray-900">{s.name}</span>
                  {value.trim().toLowerCase() === s.name.toLowerCase() && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
