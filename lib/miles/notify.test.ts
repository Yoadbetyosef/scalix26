import { describe, it, expect } from 'vitest'
import { smsBody, emailBody, smsCost, isGsm7, SMS_SEGMENT_BUDGET } from './message'
import type { HeldDraft } from './drafts'

// THE POINT OF THE NOTIFICATION IS THE DRAFT.
//
// "You have a draft waiting, open the app" is the version of this feature that fails: the owner has
// to find their password before they can find out what was written, response time collapses, and the
// thing stops being worth having. These tests exist to keep the text in the message.

const draft = (over: Partial<HeldDraft> = {}): HeldDraft => ({
  id: 'd1', tenant_id: 't1', ai_employee_id: 'miles', conversation_id: 'c1', contact_id: 'p1',
  channel: 'instagram', inbound_message_id: null,
  inbound_excerpt: 'How much would a custom setting be?',
  body: 'Customs start at $1,200 depending on the stone. Want me to book a call this week?',
  sent_body: null,
  reasons: [{ kind: 'price', evidence: '$1,200', source: 'reply' }],
  status: 'pending', created_by: 'ai', created_at: '2026-08-14T09:41:00Z',
  decided_at: null, decided_by: null, sent_message_id: null, ...over,
})

const URL = 'https://app.example.com/m/tok'

describe('the SMS', () => {
  const body = smsBody(draft(), 'Sarah M.', 'Miles', URL)

  it('carries the whole draft, verbatim', () => {
    expect(body).toContain('Customs start at $1,200 depending on the stone. Want me to book a call this week?')
  })

  it('says what the customer asked, so the reply is not read blind', () => {
    expect(body).toContain('How much would a custom setting be?')
  })

  it('says why it was held, in the classifier’s own words', () => {
    // Straight quotes and a hyphen: the typographic version costs a UCS-2 message and halves what
    // fits in a segment. The screens and the email keep the real punctuation.
    expect(body).toContain('Held: Quotes a price - "$1,200"')
  })

  it('promises that nothing goes out without a decision', () => {
    expect(body).toContain('Nothing goes out until you decide')
  })

  it('carries the link, and the link is not the message', () => {
    expect(body).toContain(URL)
    // The draft has to come before the link: what it says matters more than where to tap.
    expect(body.indexOf('Customs start at')).toBeLessThan(body.indexOf(URL))
  })

  it('never tells the owner to go and look', () => {
    expect(body).not.toMatch(/open the app|log in|sign in|view (it|the draft) in/i)
  })

  it('names who it is to and where they wrote from', () => {
    expect(body).toContain('Sarah M.')
    expect(body).toContain('instagram')
  })

  it('uses the agent’s own name', () => {
    expect(smsBody(draft(), 'Sarah M.', 'Jordan', URL)).toContain('Jordan drafted a reply')
  })
})

describe('the email', () => {
  const html = emailBody(draft(), 'Sarah M.', 'Miles', URL)

  it('carries the whole draft', () => {
    expect(html).toContain('Customs start at $1,200 depending on the stone.')
  })

  it('escapes what the customer wrote — their words are not markup', () => {
    const nasty = emailBody(
      draft({ inbound_excerpt: '<script>alert(1)</script>', body: 'a > b & c' }),
      '<b>Sarah</b>', 'Miles', URL,
    )
    expect(nasty).not.toContain('<script>')
    expect(nasty).toContain('&lt;script&gt;')
    expect(nasty).toContain('a &gt; b &amp; c')
    expect(nasty).not.toContain('<b>Sarah</b>')
  })

  it('keeps the line breaks a person typed', () => {
    expect(emailBody(draft({ body: 'one\ntwo' }), 'Sarah', 'Miles', URL)).toContain('one<br/>two')
  })

  it('links to the decision page', () => {
    expect(html).toContain(`href="${URL}"`)
  })

  it('keeps the real punctuation — an email has no segments to pay for', () => {
    expect(html).toContain('Quotes a price · “$1,200”')
  })
})

describe('what a long draft costs', () => {
  // Measured before this existed: a typical 81-character draft made a 344-character message in UCS-2,
  // which is SIX segments, and a ten-character draft still cost four. The characters forcing UCS-2
  // were not the customer's — they were a "·" and a pair of curly quotes in our own template.
  const URL_ = 'https://app.scalix26.com/m/' + 'x'.repeat(43)
  const long = 'Thank you for getting in touch about the engagement ring. '.repeat(8)

  it('stays in the alphabet that fits 153 characters per segment', () => {
    const body = smsBody(draft(), 'Sarah M.', 'Miles', URL_)
    expect(isGsm7(body)).toBe(true)
    expect(smsCost(body).encoding).toBe('GSM-7')
  })

  it('does not mangle the customer’s own words to save a segment', () => {
    // An accented name is content, not decoration. It may cost UCS-2; that is the right trade.
    const body = smsBody(draft({ inbound_excerpt: 'היי, כמה זה עולה?' }), 'Yosef', 'Miles', URL_)
    expect(body).toContain('היי')
  })

  it('never runs past the segment budget, however long the draft', () => {
    for (const n of [1, 10, 40, 80, 200, 400, 1200]) {
      const body = smsBody(draft({ body: 'x'.repeat(n) }), 'Sarah M.', 'Miles', URL_)
      expect(smsCost(body).segments).toBeLessThanOrEqual(SMS_SEGMENT_BUDGET)
    }
  })

  it('says when it cut the draft, rather than quietly shortening it', () => {
    // Approving words you believe you have read in full is the failure this avoids.
    const body = smsBody(draft({ body: long }), 'Sarah M.', 'Miles', URL_)
    expect(body).toContain('[cut - full reply in your email and at the link]')
  })

  it('cuts the draft and nothing else', () => {
    const body = smsBody(draft({ body: long }), 'Sarah M.', 'Miles', URL_)
    expect(body).toContain(URL_)
    expect(body).toContain('Nothing goes out until you decide')
    expect(body).toContain('Held:')
  })

  it('leaves an ordinary reply whole', () => {
    const body = smsBody(draft(), 'Sarah M.', 'Miles', URL_)
    expect(body).toContain('Customs start at $1,200 depending on the stone. Want me to book a call this week?')
    expect(body).not.toContain('[cut')
  })

  it('the email is never cut — it has no segments to run out of', () => {
    expect(emailBody(draft({ body: long }), 'Sarah M.', 'Miles', URL_)).toContain(long.trim().slice(0, 200))
  })
})
