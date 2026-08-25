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

export function ProductNameField({ id, value, category, onChange, className }: {
  /** Forwarded to the input so the field's own <label htmlFor> points at a real control. */
  id?: string
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
    <div ref={box} style={{ position: 'relative' }}>
      <input
        id={id}
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
        style={all.length > 0 ? { paddingRight: 22 } : undefined}
      />
      {all.length > 0 && (
        <button
          type="button" tabIndex={-1}
          onClick={() => { setOpen((o) => !o); setActive(0) }}
          aria-label="Show all products"
          style={{ position: 'absolute', right: 0, bottom: 9, background: 'none', border: 0, cursor: 'pointer', color: 'var(--v2-mute)', lineHeight: 0 }}
        ><ChevronDown className="w-4 h-4 transition-transform" style={{ transform: open ? 'rotate(180deg)' : undefined }} /></button>
      )}

      {/* The kit's typeahead popover — paper and one hairline, no shadow. What lifts a popover off
          the page is that it overlaps, not that it is shadowed. */}
      {open && all.length > 0 && (
        <ul ref={listRef} id={LISTBOX_ID} role="listbox" className="v2-pop" style={{ maxHeight: 288 }}>
          {matches.length === 0 && (
            <li style={{ padding: '9px 13px' }}>
              <span className="v2-popn">Nothing matches — “{value}” will be saved as typed.</span>
            </li>
          )}
          {rows.map(({ s: sug, heading }, i) => (
            <li key={sug.id}>
              {heading && (
                <p className="v2-kick" style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--v2-paper)', padding: '7px 13px 5px' }}>{heading}</p>
              )}
              <button
                type="button"
                data-active={i === active}
                data-on={i === active || undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(sug)}
                className="v2-popr"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}
              >
                <span className="v2-popn" style={{ textTransform: 'capitalize' }}>{sug.name}</span>
                {value.trim().toLowerCase() === sug.name.toLowerCase() && <Check className="w-3.5 h-3.5" style={{ color: 'var(--v2-t3)' }} />}
              </button>
            </li>
          ))}
          {/* Where the list itself is edited — findable from the moment someone wonders why a name is
              missing, rather than only from the catalog page. */}
          <li style={{ position: 'sticky', bottom: 0, background: 'var(--v2-paper)', borderTop: '1px solid var(--v2-line)', padding: '8px 13px' }}>
            <a href="/catalog/names" target="_blank" rel="noreferrer" className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>Edit this list ↗</a>
          </li>
        </ul>
      )}
    </div>
  )
}
