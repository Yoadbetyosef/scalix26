'use client'

import { useEffect, useState } from 'react'

// Client access to the tenant's terminology map (Core defaults merged with per-tenant overrides). Lets the UI
// relabel generic nouns — e.g. a furniture tenant shows "Inventory" for catalog and "Fabrics" for material —
// WITHOUT renaming any internal concept. Cached per session.
type TermMap = Record<string, { singular: string; plural: string }>
let cache: TermMap | null = null
let inflight: Promise<TermMap> | null = null

export function useTerminology() {
  const [map, setMap] = useState<TermMap | null>(cache) // already populated if another view cached it
  useEffect(() => {
    if (cache) return
    let alive = true
    if (!inflight) inflight = fetch('/api/core/terminology').then((r) => r.json()).then((d) => { cache = (d.terminology as TermMap) || {}; return cache }).catch(() => ({} as TermMap))
    inflight.then((m) => { if (alive) setMap(m) })
    return () => { alive = false }
  }, [])
  const term = (key: string, opts: { plural?: boolean; fallback?: string } = {}) => { const t = (map || {})[key]; return t ? (opts.plural ? t.plural : t.singular) : (opts.fallback ?? key) }
  return { term, ready: !!map }
}
