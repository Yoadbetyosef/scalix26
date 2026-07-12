import { RATE_TWILIO_VOICE_PER_MIN, RATE_DEEPGRAM_VOICE_PER_MIN, RATE_VOICE_LLM_PER_MIN } from '@/lib/cost/rates'

// Deterministic voice metering plan from a Twilio call-status callback. PURE — no I/O — so the
// "which billable events" logic is fully unit-tested. The route applies signature verification,
// tenant resolution, and the immutable meterUsage writes.
//
// Billable legs (each real Twilio leg = its own CallSid, metered once via unique(provider,resource_id)):
//   • Twilio telephony — EVERY completed leg (parent inbound + owner/transfer child legs). Twilio bills
//     per-minute, rounded UP, so quantity = ceil(CallDuration/60) with a 1-minute minimum.
//   • Deepgram voice-agent (STT+TTS+voice-LLM, one connection per call) — the AI PARENT leg only
//     (no ParentCallSid) and only when the voice server / Path A streaming is active. Billed by
//     connected time → fractional minutes = CallDuration/60.
// Never metered: unanswered / failed / busy / canceled (status !== 'completed') or zero duration.
// Duration is taken ONLY from Twilio's CallDuration — never estimated from app timestamps.

export interface VoiceCallbackParams {
  CallSid?: string
  ParentCallSid?: string
  CallStatus?: string
  CallDuration?: string
  Direction?: string
  From?: string
  To?: string
}

export interface VoiceMeterItem {
  provider: 'twilio' | 'deepgram'
  resourceId: string
  quantity: number            // minutes
  providerCostUsd: number
  metadata: Record<string, unknown>
}

// Twilio voice billing: per-minute, rounded UP; a connected call is at least 1 minute.
export function twilioBillableMinutes(durationSeconds: number): number {
  return Math.max(1, Math.ceil(durationSeconds / 60))
}

function baseMeta(p: VoiceCallbackParams, durationSeconds: number, leg: 'parent' | 'child') {
  return {
    direction: p.Direction ?? null,
    call_status: (p.CallStatus || '').toLowerCase(),
    call_sid: p.CallSid ?? null,
    parent_call_sid: p.ParentCallSid ?? null,
    from: p.From ?? null,
    to: p.To ?? null,
    duration_seconds: durationSeconds,
    leg,
  }
}

export function planVoiceMetering(p: VoiceCallbackParams, opts: { deepgramActive: boolean }): VoiceMeterItem[] {
  const status = (p.CallStatus || '').toLowerCase()
  const dur = parseInt(p.CallDuration || '0', 10) || 0
  // Only completed, non-zero-duration legs are billable. Everything else → nothing.
  if (status !== 'completed' || dur <= 0 || !p.CallSid) return []

  const isChild = !!p.ParentCallSid
  const items: VoiceMeterItem[] = []

  // Twilio telephony — every completed leg (parent + children).
  const twMin = twilioBillableMinutes(dur)
  items.push({
    provider: 'twilio', resourceId: p.CallSid, quantity: twMin,
    providerCostUsd: twMin * RATE_TWILIO_VOICE_PER_MIN,
    metadata: baseMeta(p, dur, isChild ? 'child' : 'parent'),
  })

  // Deepgram voice-agent (STT+TTS + BYO voice-LLM) — AI parent leg only, when streaming is active.
  if (!isChild && opts.deepgramActive) {
    const dgMin = dur / 60
    items.push({
      provider: 'deepgram', resourceId: p.CallSid, quantity: dgMin,
      providerCostUsd: dgMin * (RATE_DEEPGRAM_VOICE_PER_MIN + RATE_VOICE_LLM_PER_MIN),
      metadata: baseMeta(p, dur, 'parent'),
    })
  }
  return items
}
