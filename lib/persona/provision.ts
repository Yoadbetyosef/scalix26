import type { SupabaseClient } from '@supabase/supabase-js'
import { PERSONAS } from '@/lib/persona'
import { agentByPersona, primaryAgent } from '@/lib/agents/primary'
import { canAddEmployee, planLimitMessage } from '@/lib/plans'

// HIRING MILES.
//
// A second ai_employees row, wearing the miles persona. Deliberately NOT routed through
// /api/agents/create: that path is the "new phone employee" flow — it reuses unfinished drafts and
// leads to a number being bought on the edit screen's save. Miles owns messages. He must never be
// handed the phone, and he must never be picked up as somebody's half-finished draft.
//
// The plan gate is the EXISTING one. `maxEmployeesForPlan` is untouched — trial and Starter allow one
// employee, so on those plans this refuses, which is exactly "Miles requires Pro" without inventing a
// second entitlement to keep in sync with the first.

export interface MilesAgent {
  id: string
  name: string
  persona: string
}

export type MilesResult =
  | { ok: true; agent: MilesAgent; created: boolean }
  | { ok: false; reason: 'no_tenant' | 'plan_limit' | 'insert_failed'; message: string }

// The business identity block: it describes the BUSINESS, not the employee, so Miles inherits it.
//
// Listed once and copied field by field rather than spread. A spread would trust the select list to
// be the guard, and the day someone adds a column to IDENTITY_COLS to fix something else, Miles
// quietly inherits a phone number, a status, or an id. Named fields cannot do that.
const IDENTITY_FIELDS = [
  'business_name', 'industry', 'website', 'phone', 'email',
  'address', 'city', 'state', 'zip', 'business_hours', 'timezone',
] as const

const IDENTITY_COLS = IDENTITY_FIELDS.join(', ')

type Identity = Record<string, unknown>

/** Only the named fields, and only the ones the source row actually had. */
function identityOf(row: Identity | null): Identity {
  const out: Identity = {}
  if (!row) return out
  for (const f of IDENTITY_FIELDS) if (row[f] !== undefined) out[f] = row[f]
  return out
}

/**
 * Idempotent: a tenant has at most one Miles, enforced by a partial unique index as well as by this
 * check, because two employees racing to answer the same Instagram DM is not a state worth recovering
 * from gracefully.
 */
export async function ensureMilesAgent(db: SupabaseClient, tenantId: string): Promise<MilesResult> {
  const { data: tenant } = await db.from('tenants').select('id, plan').eq('id', tenantId).maybeSingle()
  if (!tenant) return { ok: false, reason: 'no_tenant', message: 'Account not found' }

  const existing = await agentByPersona<MilesAgent>(db, tenantId, 'miles', 'id, name, persona')
  if (existing) return { ok: true, agent: existing, created: false }

  const { count } = await db
    .from('ai_employees').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
  if (!canAddEmployee(count ?? 0, tenant.plan)) {
    return { ok: false, reason: 'plan_limit', message: planLimitMessage(tenant.plan) }
  }

  // Copy the business identity from the tenant's default agent. Not a convenience: an agent with an
  // empty identity answers as a business with no name, and Miles works for the same business Rudi
  // does. What is NOT copied is everything that belongs to the employee rather than the business —
  // greeting and forward_to_phone are phone concerns, and system_prompt is his own.
  const identity = identityOf(await primaryAgent<Identity>(db, tenantId, IDENTITY_COLS))

  const persona = PERSONAS.miles
  const { data: created, error } = await db
    .from('ai_employees')
    .insert({
      ...identity,
      tenant_id: tenantId,
      name: persona.name,
      voice: persona.voice,
      avatar_url: persona.avatar,
      persona: persona.key,
      status: 'active',
      // Never reusable as a draft: /api/agents/create adopts any setup_complete=false row, and
      // adopting Miles would rename him and sell him a phone number.
      setup_complete: true,
    })
    .select('id, name, persona')
    .single()

  if (error || !created) {
    return {
      ok: false,
      reason: 'insert_failed',
      message: error?.message ?? 'Could not create the messages employee',
    }
  }
  return { ok: true, agent: created as MilesAgent, created: true }
}
