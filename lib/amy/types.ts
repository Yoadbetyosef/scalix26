import type { SupabaseClient } from '@supabase/supabase-js'

// ── Business Context Layer ──────────────────────────────────────────────────────
// Amy is the operating system of ONE business. Every context source is strictly
// tenant-scoped: it receives the tenantId resolved server-side from the authenticated
// owner and MUST filter every query by it. The model supplies search args (keywords,
// dates) — never the tenantId — so Amy can never reach another tenant's data.
//
// Adding a new data source = add one file implementing ContextSource and register it.
// Amy's core intelligence (the agent loop + prompt) never changes.

export interface SourceContext {
  /** The ONLY business Amy may read. Injected from the verified session, never the model. */
  tenantId: string
  /** Service-role client — every query in a source MUST `.eq('tenant_id', ctx.tenantId)`. */
  db: SupabaseClient
}

export interface ContextSource {
  /** Tool name exposed to the model, e.g. 'search_conversations'. */
  id: string
  /** When Amy should use this source (shown to the model). */
  description: string
  /** JSON schema for the tool's args. Must NOT include tenant/owner identifiers. */
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  /** Retrieve tenant-scoped data and return a concise text summary for the model. */
  run(ctx: SourceContext, args: Record<string, unknown>): Promise<string>
}

export const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
export const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
