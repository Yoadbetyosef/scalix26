import { describe, it, expect } from 'vitest'
import { classifyReply, heldSince, type AutonomyRule } from './autonomy'

// The rule this file tests is the whole feature: what Miles may say in the owner's name without
// asking. Each case below is written as the sentence a real reply would contain, because that is what
// the classifier actually sees.

const send = (reply: string, over: Partial<Parameters<typeof classifyReply>[0]> = {}) =>
  classifyReply({ reply, inbound: '', grounded: true, ...over })

describe('sends immediately — the left column', () => {
  it('states opening hours, which are dates and times and not a promise', () => {
    const d = send("We're open Monday to Friday, 9am to 5pm, and closed Sunday.")
    expect(d.verdict).toBe('send')
  })

  it('gives the address', () => {
    expect(send("We're at 14 Bond Street, right by the station.").verdict).toBe('send')
  })

  it('answers a fact from the knowledge base', () => {
    expect(send('Yes, all our rings come with a lifetime cleaning service.').verdict).toBe('send')
  })

  it('says whether a slot is open without taking it', () => {
    expect(send('We do have availability that week.').verdict).toBe('send')
  })

  it('offers delivery as a fact, without promising a date', () => {
    expect(send('Yes, we deliver anywhere in the country.').verdict).toBe('send')
  })

  it('says "feel free to ask" without that being a price', () => {
    // A detector that held on the word "free" would fire on half of all replies, and an owner who
    // stops reading the reasons is an owner who approves without reading the draft.
    expect(send('Feel free to send over a photo and we can take a look.').verdict).toBe('send')
  })

  it('books into a window the owner already published', () => {
    const d = send("You're confirmed for Tuesday at 2pm.", { bookingWithinAvailability: true })
    expect(d.verdict).toBe('send')
  })
})

describe('drafts and waits — the right column', () => {
  it('holds any figure with a currency', () => {
    const d = send('That would be $1,200 including the setting.')
    expect(d.verdict).toBe('hold')
    expect(d.commitments[0]).toMatchObject({ kind: 'price', evidence: '$1' })
    expect(d.summary).toBe('Quotes a price')
  })

  it('holds a price with no symbol', () => {
    expect(send('It comes to about 450 dollars.').verdict).toBe('hold')
  })

  it('holds the word quote even with no number attached', () => {
    expect(send("I'll put a quote together for you.").verdict).toBe('hold')
  })

  it('holds an hourly rate', () => {
    expect(send('It works out at 90 an hour.').verdict).toBe('hold')
  })

  it('holds a discount', () => {
    expect(send('I can do 10% off for you.').verdict).toBe('hold')
  })

  it('holds "for free" — a commitment that something costs nothing is still a price', () => {
    expect(send('We can do the resize for free.').verdict).toBe('hold')
  })

  it('holds a first-person undertaking on a date', () => {
    const d = send("We'll have it ready Tuesday.")
    expect(d.verdict).toBe('hold')
    expect(d.commitments[0].kind).toBe('schedule')
  })

  it('holds a lead time with no pronoun at all', () => {
    expect(send('Turnaround is about two weeks.').verdict).toBe('hold')
    expect(send('It will be ready by Friday.').verdict).toBe('hold')
    expect(send('Delivery by the 14th.').verdict).toBe('hold')
  })

  it('holds a booking that is NOT inside a published window', () => {
    // Same sentence as the send case above. The only difference is whether the slot exists.
    expect(send("You're confirmed for Tuesday at 2pm.").verdict).toBe('hold')
  })

  it('holds a complaint the customer raised, however calm the reply is', () => {
    const d = classifyReply({
      reply: 'Thank you for letting us know — someone will look into this.',
      inbound: 'The bracelet arrived damaged and I want a refund.',
      grounded: true,
    })
    expect(d.verdict).toBe('hold')
    expect(d.commitments.map((c) => c.kind)).toContain('grievance')
    expect(d.commitments.find((c) => c.kind === 'grievance')?.source).toBe('inbound')
  })

  it('holds a refund offered in the reply', () => {
    const d = send('We can refund you in full.')
    expect(d.commitments.some((c) => c.kind === 'grievance' && c.source === 'reply')).toBe(true)
  })

  it('holds anything with no answer in the knowledge base', () => {
    const d = send('I believe we can do that, yes.', { grounded: false })
    expect(d.verdict).toBe('hold')
    expect(d.summary).toBe('No answer in the knowledge base')
  })

  it('holds an empty draft rather than treating it as nothing to say', () => {
    expect(send('   ').verdict).toBe('hold')
  })

  it('names every reason when a reply commits to more than one thing', () => {
    const d = send("We'll have it ready Tuesday and it'll be $300.")
    expect(d.verdict).toBe('hold')
    expect(new Set(d.commitments.map((c) => c.kind))).toEqual(new Set(['price', 'schedule']))
    expect(d.summary).toBe('Quotes a price · Commits to a date')
  })

  it('quotes the exact text that caused the hold', () => {
    // "Held because of something" is not a reason a person can act on.
    const d = send('The repair is £85.')
    expect(d.commitments[0].evidence).toContain('£')
  })
})

describe('complaints in the words people actually use', () => {
  // Every line here came from probing the classifier with sentences no test had been written for.
  // Two of them were being SENT: "this is taking forever, I ordered 3 weeks ago" (no complaint
  // vocabulary at all) and "the clasp broke after a week" (the detector knew "broken", not "broke").
  const calm = 'Thanks for letting us know, I will look into this.'

  it.each([
    'This is taking forever, I ordered 3 weeks ago.',
    'Where is my order? No one has replied to me.',
    'I am not happy with this at all.',
    'Still waiting on the repair you promised.',
    'The clasp broke after a week.',
    'I paid 2 weeks ago and heard nothing.',
    'Honestly the service has been terrible.',
  ])('holds: %s', (inbound) => {
    expect(classifyReply({ reply: calm, inbound, grounded: true }).verdict).toBe('hold')
  })

  it.each([
    'What time do you close today?',
    'Do you have this in a size M?',
    'Can I book in for next week?',
    'Thanks, that is great news!',
    'Is the shop open on Sunday?',
    'I ordered from you last year and loved it.',
  ])('does not mistake an ordinary question for a complaint: %s', (inbound) => {
    expect(classifyReply({ reply: 'Yes, we are open until five.', inbound, grounded: true }).verdict).toBe('send')
  })
})

describe('the owner’s own rules — set by telling Miles, not by a form', () => {
  const rule = (over: Partial<AutonomyRule>): AutonomyRule =>
    ({ id: 'r1', kind: 'price', action: 'hold', phrase: 'don’t quote prices without me', ...over })

  it('lets the owner take back a kind Miles was sending', () => {
    const d = send('We deliver anywhere in the country.', {
      rules: [rule({ kind: 'all', action: 'hold', phrase: 'show me everything for now' })],
    })
    expect(d.verdict).toBe('hold')
    expect(d.commitments[0]).toMatchObject({ kind: 'rule', evidence: 'show me everything for now' })
  })

  it('lets the owner hand a kind over', () => {
    const d = send('It works out at 90 an hour.', {
      rules: [rule({ kind: 'price', action: 'send', phrase: 'you can quote the standard rates' })],
    })
    expect(d.verdict).toBe('send')
  })

  it('a hand-over of one kind does not hand over the others', () => {
    const d = send("We'll have it ready Tuesday for $300.", {
      rules: [rule({ kind: 'price', action: 'send', phrase: 'you can quote prices' })],
    })
    expect(d.verdict).toBe('hold')
    expect(d.commitments.map((c) => c.kind)).toEqual(['schedule'])
  })

  it('never hands over an ungrounded answer, whatever the rule says', () => {
    // "You can answer that yourself" and "make something up" are different sentences.
    const d = send('I think so, yes.', {
      grounded: false,
      rules: [rule({ kind: 'all', action: 'send', phrase: 'just answer everything' })],
    })
    expect(d.verdict).toBe('hold')
    expect(d.commitments.map((c) => c.kind)).toEqual(['ungrounded'])
  })

  it('a hold rule cannot invent a commitment that is not in the text', () => {
    const d = send("We're open until six.", {
      rules: [rule({ kind: 'price', action: 'hold', phrase: 'never quote prices' })],
    })
    expect(d.verdict).toBe('send')
  })

  it('reads the rule back in the owner’s own words', () => {
    const d = send('That would be $1,200.', {
      rules: [rule({ phrase: 'never send a price without checking with me first' })],
    })
    expect(d.commitments.some((c) => c.evidence === 'never send a price without checking with me first')).toBe(true)
  })
})

describe('heldSince — every held draft shows how long it has waited', () => {
  const at = (mins: number) => new Date(Date.UTC(2026, 7, 14, 12, 0, 0) - mins * 60_000).toISOString()
  const now = new Date(Date.UTC(2026, 7, 14, 12, 0, 0))

  it('reads in the units a person would use', () => {
    expect(heldSince(at(0), now)).toBe('just now')
    expect(heldSince(at(1), now)).toBe('1 minute')
    expect(heldSince(at(41), now)).toBe('41 minutes')
    expect(heldSince(at(60), now)).toBe('1 hour')
    expect(heldSince(at(60 * 5), now)).toBe('5 hours')
    expect(heldSince(at(60 * 24), now)).toBe('1 day')
    expect(heldSince(at(60 * 24 * 3), now)).toBe('3 days')
  })

  it('says nothing rather than something wrong', () => expect(heldSince('not a date', now)).toBe(''))
})
