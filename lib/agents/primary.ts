import type { SupabaseClient } from '@supabase/supabase-js'

// WHICH AGENT DOES A TENANT MEAN WHEN NOTHING SAID WHICH?
//
// Seven live paths asked that question and seven of them answered it the same wrong way:
//
//   .eq('tenant_id', t).eq('status', 'active').maybeSingle()
//
// That reads as "the tenant's active agent" and behaves that way for exactly as long as there is one.
// `maybeSingle()` tolerates ZERO rows, not two: postgrest-js enforces the cardinality client-side and
// returns PGRST116 with `data: null` the moment a second row comes back
// (@supabase/postgrest-js/src/PostgrestBuilder.ts, the isMaybeSingle branch). Every agent is created
// `status: 'active'` (app/api/agents/create/route.ts), so the second employee does not degrade those
// seven paths — it nulls them. Inbound SMS threw. Voice lost its greeting. Email answered as the
// wrong agent, silently.
//
// One resolver, one ordering, and `.limit(1)` BEFORE `.maybeSingle()` so the cardinality error is
// unreachable rather than unlikely.
//
// ── WHY created_at AND NOT persona ──────────────────────────────────────────────────────────────────
//
// It would read better to say "the agent who is not Miles". It would also break every one of these
// paths in the window between deploying the code and running the migration, because a filter on a
// column that does not exist yet returns an error, and an error here is a dropped phone call. Oldest
// active agent is migration-independent and gives single-agent tenants — which is all of them today —
// byte-identical behaviour. When a path genuinely wants the messages employee it will say so at the
// call site, with `agentByPersona`.

/**
 * The tenant's default agent: the oldest ACTIVE one, or null when the tenant has none.
 *
 * Deliberately does NOT fall back to a draft agent. Today a tenant whose only agent is a draft gets
 * no reply, and that is the correct behaviour to preserve — a draft has not been finished, and
 * answering a customer from an unfinished agent is worse than not answering.
 *
 * @param columns the select list, passed through verbatim so each caller keeps its own projection.
 */
export async function primaryAgent<T = Record<string, unknown>>(
  db: SupabaseClient,
  tenantId: string,
  columns: string,
): Promise<T | null> {
  const { data } = await db
    .from('ai_employees')
    .select(columns)
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as T | null) ?? null
}

/**
 * The agent wearing a given persona — the messages employee, or the phone one.
 *
 * Requires `add_miles_persona.sql`. Unlike `primaryAgent` this is only called from paths that exist
 * because Miles does, so there is no pre-migration window to survive.
 */
export async function agentByPersona<T = Record<string, unknown>>(
  db: SupabaseClient,
  tenantId: string,
  persona: string,
  columns: string,
): Promise<T | null> {
  const { data } = await db
    .from('ai_employees')
    .select(columns)
    .eq('tenant_id', tenantId)
    .eq('persona', persona)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as T | null) ?? null
}
