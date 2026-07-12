import { describe, it, expect } from 'vitest'
import { planVoiceMetering, twilioBillableMinutes, type VoiceCallbackParams } from './voice-meter'

const completed = (over: Partial<VoiceCallbackParams> = {}): VoiceCallbackParams =>
  ({ CallSid: 'CA1', CallStatus: 'completed', CallDuration: '120', Direction: 'inbound', From: '+1555', To: '+1999', ...over })

describe('twilioBillableMinutes (per-minute, rounded up, 1-min minimum)', () => {
  it('rounds up', () => {
    expect(twilioBillableMinutes(1)).toBe(1)
    expect(twilioBillableMinutes(60)).toBe(1)
    expect(twilioBillableMinutes(61)).toBe(2)
    expect(twilioBillableMinutes(120)).toBe(2)
    expect(twilioBillableMinutes(121)).toBe(3)
  })
})

describe('planVoiceMetering — deterministic, completed-only', () => {
  it('120s completed parent call (Path A) → twilio (2 min) + deepgram (2.0 min)', () => {
    const plan = planVoiceMetering(completed({ CallDuration: '120' }), { deepgramActive: true })
    expect(plan).toHaveLength(2)
    const tw = plan.find((i) => i.provider === 'twilio')!
    const dg = plan.find((i) => i.provider === 'deepgram')!
    expect(tw.resourceId).toBe('CA1')
    expect(tw.quantity).toBe(2)                          // ceil(120/60)
    expect(tw.providerCostUsd).toBeCloseTo(2 * 0.0085, 6)
    expect(dg.quantity).toBeCloseTo(2.0, 6)              // 120/60 fractional
    expect(dg.providerCostUsd).toBeCloseTo(2.0 * (0.075 + 0.011), 6)
    expect(tw.metadata.leg).toBe('parent')
    expect(tw.metadata.call_status).toBe('completed')
    expect(tw.metadata.direction).toBe('inbound')
  })

  it('child leg (ParentCallSid set) → twilio ONLY (no Deepgram)', () => {
    const plan = planVoiceMetering(completed({ CallSid: 'CA2', ParentCallSid: 'CA1' }), { deepgramActive: true })
    expect(plan).toHaveLength(1)
    expect(plan[0].provider).toBe('twilio')
    expect(plan[0].metadata.leg).toBe('child')
    expect(plan[0].metadata.parent_call_sid).toBe('CA1')
  })

  it('deepgram not metered when streaming inactive (Path B)', () => {
    const plan = planVoiceMetering(completed(), { deepgramActive: false })
    expect(plan.map((i) => i.provider)).toEqual(['twilio'])
  })

  it.each(['no-answer', 'busy', 'failed', 'canceled'])('non-completed status "%s" → no usage', (st) => {
    expect(planVoiceMetering(completed({ CallStatus: st }), { deepgramActive: true })).toEqual([])
  })

  it('zero / missing duration → no usage (never estimated)', () => {
    expect(planVoiceMetering(completed({ CallDuration: '0' }), { deepgramActive: true })).toEqual([])
    expect(planVoiceMetering(completed({ CallDuration: undefined }), { deepgramActive: true })).toEqual([])
  })

  it('missing CallSid → no usage', () => {
    expect(planVoiceMetering(completed({ CallSid: undefined }), { deepgramActive: true })).toEqual([])
  })

  it('1-second connected call still bills 1 Twilio minute', () => {
    const plan = planVoiceMetering(completed({ CallDuration: '1' }), { deepgramActive: false })
    expect(plan[0].quantity).toBe(1)
  })
})
