import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { triggerLine } from './inbox-read'
import { classifyReply } from './autonomy'

// WHY A ROW SAYS MORE THAN "DRAFT READY".
//
// The mockup's row reads "Draft ready · price quote". A person scanning five of those approves
// without opening any of them — the row has told them a draft exists, which they can see, and not
// what it commits them to, which they cannot. So the row carries the classifier's own label AND the
// exact text that triggered it.

describe('triggerLine', () => {
  it('quotes the words that caused the hold', () => {
    const d = classifyReply({ reply: 'That would be $1,200 including the setting.', inbound: '', grounded: true })
    expect(triggerLine(d.commitments)).toBe('Quotes a price · “$1,200”')
  })

  it('uses the classifier’s own label, not a second vocabulary', () => {
    const d = classifyReply({ reply: 'We can refund you in full.', inbound: '', grounded: true })
    expect(triggerLine(d.commitments)).toContain('A complaint, refund or compensation')
  })

  it('counts the rest rather than running the row off the screen', () => {
    const d = classifyReply({ reply: "We'll have it ready Tuesday and it'll be $300.", inbound: '', grounded: true })
    expect(d.commitments).toHaveLength(2)
    expect(triggerLine(d.commitments)).toMatch(/\+1$/)
  })

  it('counts KINDS, not reasons — one complaint found twice is still one thing to know', () => {
    // A grievance in the customer's message AND in the reply used to render as "+1", which reads as
    // a second, different reason the owner has not been told.
    const d = classifyReply({
      reply: 'We can refund you in full.',
      inbound: 'The clasp broke and I want a refund.',
      grounded: true,
    })
    expect(d.commitments.length).toBe(2)
    expect(new Set(d.commitments.map((c) => c.kind)).size).toBe(1)
    expect(triggerLine(d.commitments)).not.toMatch(/\+/)
  })

  it('does not put a placeholder in quotation marks', () => {
    // "(not answered from what the business has told us)" is a note, not something anybody said.
    const d = classifyReply({ reply: 'I believe so, yes.', inbound: '', grounded: false })
    expect(triggerLine(d.commitments)).toBe('No answer in the knowledge base')
    expect(triggerLine(d.commitments)).not.toContain('“')
  })

  it('says something rather than nothing when a row has no reasons at all', () => {
    expect(triggerLine([])).toBe('Held for review')
  })
})

describe('the screen shows what the classifier said, and what went out', () => {
  const raw = readFileSync(new URL('../../app/(v2)/v2/messages/client.tsx', import.meta.url), 'utf8')
  // Comments explain why the row does NOT say "Draft ready"; scanning them would fail the very check
  // the comment documents. Same stripping the other /v2 guards do.
  const client = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

  it('renders the trigger on the waiting row', () => {
    expect(client).toContain('{row.trigger}')
  })

  it('never hardcodes the mockup’s "Draft ready" instead', () => {
    expect(client).not.toMatch(/Draft ready/)
  })

  it('renders the exact text that was sent on a handled row', () => {
    // A row saying "handled" without the words sent in the owner's name is the thing that would
    // destroy trust in this feature.
    expect(client).toContain('{row.sent}')
  })

  it('offers all three actions, and no fourth', () => {
    const acts = [...client.matchAll(/data-act="(\w+)"/g)].map((m) => m[1])
    expect(new Set(acts)).toEqual(new Set(['send', 'edit', 'mine']))
  })

  it('says how long each draft has waited, in both places the mockup does', () => {
    expect(client).toContain('Nothing goes out until you decide')
    expect((client.match(/heldSince\(row\.heldSince\)/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})

describe('the thread no longer speaks for the wrong employee', () => {
  const thread = readFileSync(new URL('../../app/(v2)/v2/thread.tsx', import.meta.url), 'utf8')

  it('reads the agent’s name instead of the literal "Rudi"', () => {
    expect(thread).toContain("aiName || 'AI'")
    // The name may still appear in prose explaining the change; it must not be rendered as a value.
    expect(thread).not.toMatch(/\?\s*'Rudi'\s*:/)
  })
})
