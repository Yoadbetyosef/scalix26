import { createAdminClient } from '@/lib/supabase/server'
import { ACTIONS, type ActionType } from './registry'
import { getIntegrations, type IntegrationKey } from './integrations'
import { hasPermission } from './permissions'
import { enabledModulesOf } from '@/lib/modules'
import { sendSMS } from '@/lib/twilio/client'

type DB = ReturnType<typeof createAdminClient>

export interface Precheck { ok: boolean; reason?: string }

function integrationMissing(k: IntegrationKey): string {
  const map: Record<IntegrationKey, string> = {
    email: 'I can’t send this yet because email (Gmail) is not connected.',
    instagram: 'Instagram is not connected for this business.',
    facebook: 'Facebook is not connected for this business.',
    twilio: 'Texting isn’t set up yet — there’s no connected phone number.',
    stripe: 'Stripe is not connected, so I can’t send payment links.',
    calendar: 'The calendar is not connected.',
  }
  return map[k]
}

/** Gate an action: module → permission → integration → executor. Returns the honest reason
 * the assistant must relay when blocked (never a fake success). */
export async function precheckAction(tenantId: string, type: ActionType): Promise<Precheck> {
  const def = ACTIONS[type]
  if (!def) return { ok: false, reason: 'I can’t do that action yet. I can help draft it, but I can’t send it until this action is connected.' }

  if (def.module) {
    const { data } = await createAdminClient().from('tenants').select('enabled_modules').eq('id', tenantId).maybeSingle()
    if (!enabledModulesOf(data).includes(def.module)) return { ok: false, reason: `The ${def.module.replace(/_/g, ' ')} module isn’t enabled for this business.` }
  }
  if (!hasPermission(def.permission, tenantId)) return { ok: false, reason: `I don’t have permission to ${def.label.toLowerCase()}.` }
  if (def.integration) {
    const ints = await getIntegrations(tenantId)
    if (!ints[def.integration]) return { ok: false, reason: integrationMissing(def.integration) }
  }
  if (!def.supported) return { ok: false, reason: `I can’t do that action yet. I can help draft it, but I can’t ${def.label.toLowerCase()} until this action is connected.` }
  return { ok: true }
}

export interface CreatePendingInput { tenantId: string; userId?: string | null; type: ActionType; target?: string | null; body?: string; details?: Record<string, unknown> }
export async function createPendingAction(i: CreatePendingInput): Promise<{ id: string }> {
  const def = ACTIONS[i.type]
  const { data, error } = await createAdminClient().from('assistant_actions').insert({
    tenant_id: i.tenantId, user_id: i.userId ?? null, action_type: i.type, channel: def?.channel ?? null,
    target_id: i.target ?? null, payload: { body: i.body ?? null, ...(i.details || {}) }, status: 'pending',
  }).select('id').single()
  if (error) throw new Error(error.message)
  return { id: data.id }
}

export interface ExecuteResult { ok: boolean; status: 'executed' | 'failed'; error?: string; external_response_id?: string }

/** Execute a pending action for real, then record the true result. */
export async function executeAction(actionId: string, tenantId: string, userId?: string): Promise<ExecuteResult> {
  const db = createAdminClient()
  const { data: action } = await db.from('assistant_actions').select('*').eq('id', actionId).eq('tenant_id', tenantId).maybeSingle()
  if (!action) return { ok: false, status: 'failed', error: 'Action not found.' }
  if (action.status === 'executed') return { ok: true, status: 'executed', external_response_id: action.external_response_id || undefined }

  const type = action.action_type as ActionType
  const pre = await precheckAction(tenantId, type)
  if (!pre.ok) { await fail(db, actionId, pre.reason || 'Not available.'); return { ok: false, status: 'failed', error: pre.reason } }

  await db.from('assistant_actions').update({ status: 'confirmed', confirmed_at: new Date().toISOString(), user_id: action.user_id ?? userId ?? null }).eq('id', actionId)

  try {
    let externalId: string | undefined
    if (type === 'send_sms') {
      const to = String(action.target_id || '')
      const body = String((action.payload as { body?: string })?.body || '')
      if (!to) throw new Error('No recipient phone number.')
      if (!body) throw new Error('No message body.')
      const { data: ch } = await db.from('channels').select('twilio_number').eq('tenant_id', tenantId).not('twilio_number', 'is', null).limit(1).maybeSingle()
      const res = await sendSMS(to, body, ch?.twilio_number || undefined)
      externalId = (res as { sid?: string })?.sid
    } else {
      throw new Error('No executor is connected for this action yet.')
    }
    await db.from('assistant_actions').update({ status: 'executed', executed_at: new Date().toISOString(), external_response_id: externalId ?? null }).eq('id', actionId)
    return { ok: true, status: 'executed', external_response_id: externalId }
  } catch (e) {
    const msg = (e as Error).message || 'The API failed. Please try again.'
    await fail(db, actionId, msg)
    return { ok: false, status: 'failed', error: msg }
  }
}

async function fail(db: DB, id: string, msg: string) {
  await db.from('assistant_actions').update({ status: 'failed', error_message: msg }).eq('id', id)
}
