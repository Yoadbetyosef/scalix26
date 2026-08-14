import { describe, it, expect } from 'vitest'
import { smsBody, emailBody } from './message'
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
    expect(body).toContain('Quotes a price · “$1,200”')
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
})
