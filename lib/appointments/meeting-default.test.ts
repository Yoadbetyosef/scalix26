import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveMeetingDefault, meetingDefaultInstruction, TRAVELLING_TRADES } from './meeting-default'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

describe('what an in-person booking means for this business', () => {
  it('the stored column always wins, even against its own industry', () => {
    // Smith Hvac reads 'HVAC' and is set to at_business on purpose. A derivation that overrode it
    // would make the override invisible, which is the opposite of what an override is for.
    expect(resolveMeetingDefault({ default_meeting_kind: 'at_business', industry: 'HVAC' })).toBe('at_business')
    expect(resolveMeetingDefault({ default_meeting_kind: 'on_site', industry: 'Other' })).toBe('on_site')
  })

  it('the nine travelling trades derive silently', () => {
    for (const t of ['HVAC', 'Plumbing', 'Electrical', 'Cleaning', 'Landscaping', 'Roofing', 'Pest Control', 'Handyman', 'Pool Service', 'Locksmith']) {
      expect(resolveMeetingDefault({ industry: t }), t).toBe('on_site')
    }
    // Case and padding are the tenant's, not ours.
    expect(resolveMeetingDefault({ industry: '  plumbing ' })).toBe('on_site')
  })

  it('and EVERYTHING else is null, which means ask', () => {
    // 13 of 33 live tenants read 'Other' and 8 read null. Every business with this problem is in
    // those two buckets — including the one whose industry says HVAC and sells engagement rings.
    for (const v of ['Other', '', null, undefined, 'Jewellery', 'Dental', 'Salon']) {
      expect(resolveMeetingDefault({ industry: v as string | null }), String(v)).toBeNull()
    }
    expect(resolveMeetingDefault(null)).toBeNull()
    expect(resolveMeetingDefault({})).toBeNull()
  })

  it('an unrecognised stored value falls through to the derivation rather than being trusted', () => {
    expect(resolveMeetingDefault({ default_meeting_kind: 'zoom', industry: 'HVAC' })).toBe('on_site')
    expect(resolveMeetingDefault({ default_meeting_kind: 'nonsense', industry: 'Other' })).toBeNull()
  })

  it('the match is exact, never a keyword', () => {
    // A fuzzy rule would eventually catch something it should not — 'Other' has to fall through.
    expect(TRAVELLING_TRADES.has('other')).toBe(false)
    expect(resolveMeetingDefault({ industry: 'Plumbing supplies retailer' })).toBeNull()
  })
})

describe('the instruction the agent is given', () => {
  it('at_business tells it not to ask for an address', () => {
    const s = meetingDefaultInstruction('at_business')
    expect(s).toContain('at_business')
    expect(s).toContain('do NOT ask for their address')
  })

  it('on_site tells it to ask — and to book anyway when refused', () => {
    // The loop with no exit: a customer who would not give an address never reached a booking.
    const s = meetingDefaultInstruction('on_site')
    expect(s).toContain('book anyway')
    expect(s).toContain('never refuse a booking over a missing address')
  })

  it('unknown ASKS rather than assuming travel — the whole bug', () => {
    const s = meetingDefaultInstruction(null)
    expect(s).toContain('will you be coming to us')
    expect(s).toContain('ONLY in the on_site case')
    expect(s).not.toContain('do NOT ask for their address')
  })

  it('and both agents are given it, from this one helper', () => {
    // The two prompts are built separately. A rule stated in one of them holds on one channel.
    for (const f of ['../../app/api/webhooks/twilio/voice/route.ts', '../anthropic/pipeline.ts']) {
      expect(read(f), f).toContain('meetingDefaultInstruction(resolveMeetingDefault(')
    }
  })
})

describe('the answer is learned, not configured', () => {
  const create = read('./create.ts')

  it('the first in-person booking writes it back', () => {
    expect(create).toContain("if (!tenant.default_meeting_kind && (kind === 'on_site' || kind === 'at_business')) {")
  })

  it('a video call teaches it nothing', () => {
    const block = create.slice(create.indexOf('LEARNED, NOT CONFIGURED'))
    expect(block).not.toMatch(/kind === 'zoom'|kind === 'phone'/)
  })

  it("and an owner's explicit setting is never overwritten by a booking", () => {
    expect(create).toContain(".is('default_meeting_kind', null)")
  })

  it('and it can never cost the appointment', () => {
    // The booking is the thing that matters; this is a note taken beside it.
    expect(create).toContain('.then(() => {}, () => {})')
  })
})
