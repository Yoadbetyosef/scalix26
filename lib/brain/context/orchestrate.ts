import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/server'
import { PROVIDERS } from './registry'
import type { ContextProvider, ContextRequest } from './types'

// The header is the anti-hallucination contract: the model must answer only from the data below (plus the
// knowledge base) and explicitly say "not available" for anything absent — never invent prices/stock/dates.
const HEADER =
  '[LIVE BUSINESS DATA] The following is real, current data for THIS business. Answer the customer ONLY from ' +
  'this data and the knowledge base. If a specific detail (a price, stock level, order status, date, etc.) is not ' +
  'shown here, tell the customer it is not available and offer to check — do NOT guess, estimate, or invent it.'

// Pure: which providers are relevant to this turn. Exported for tests.
export function detectProviders(
  query: string,
  essentialsOnly: boolean,
  providers: ContextProvider[] = PROVIDERS,
  include: string[] = [], // provider keys to force-include regardless of query (e.g. voice grounding)
): ContextProvider[] {
  const forced = (p: ContextProvider) => p.alwaysOn || include.includes(p.key)
  if (essentialsOnly) return providers.filter(forced)
  const q = (query || '').toLowerCase()
  if (!q.trim()) return providers.filter(forced)
  return providers.filter((p) => forced(p) || p.keywords.some((k) => q.includes(k)))
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))])
}

// Assemble the live-business-context block for one AI turn. Best-effort and self-contained: a slow or failing
// provider degrades to an "unavailable" line and never blocks or breaks the reply. Returns '' when nothing is
// relevant (so callers can inject unconditionally).
export async function assembleBusinessContext(
  req: ContextRequest & { essentialsOnly?: boolean },
  opts: { providers?: ContextProvider[]; db?: SupabaseClient; include?: string[] } = {},
): Promise<string> {
  const providers = opts.providers ?? PROVIDERS
  const matched = detectProviders(req.query, !!req.essentialsOnly, providers, opts.include ?? [])
  if (!matched.length) return ''
  const db = opts.db ?? createAdminClient()
  const results = await Promise.all(
    matched.map((p) => {
      const unavailable = { available: false, text: `${p.label} is temporarily unavailable.` }
      return withTimeout(p.fetch(req, db).catch(() => unavailable), 2500, unavailable)
    }),
  )
  const sections = matched.map((p, i) => `## ${p.label}\n${results[i].text.trim()}`)
  return `${HEADER}\n\n${sections.join('\n\n')}`
}
