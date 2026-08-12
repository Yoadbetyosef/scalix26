import { describe, expect, it } from 'vitest'
import { replyLine } from './reply-line'

const join = (segs: { text: string }[]) => segs.map((s) => s.text).join('')
const accented = (segs: { text: string; accent?: boolean }[]) => segs.filter((s) => s.accent).map((s) => s.text)

describe('the gradient marks one clause, never the whole reply', () => {
  it('accents the question', () => {
    const s = replyLine("Ridgewood hasn't opened the quote yet. Want me to send a nudge?")
    expect(accented(s)).toEqual(['Want me to send a nudge?'])
  })

  it('accents the clause that resolves it', () => {
    const s = replyLine('Two calls came in while you were out. Both booked, nothing needs you.')
    expect(accented(s)).toEqual(['nothing needs you.'])
  })

  it('leaves a plain report entirely white', () => {
    // The common case. Finding nothing to accent is the right answer, not a failure.
    const s = replyLine('I handled twenty-five conversations this month.')
    expect(accented(s)).toEqual([])
    expect(s).toHaveLength(1)
  })

  it('never accents more than one clause', () => {
    const s = replyLine('Should I call them? Or would you like me to email instead?')
    expect(accented(s)).toHaveLength(1)
  })

  it('never accents the whole reply, even when the whole reply is the ask', () => {
    // Emphasis needs something to contrast with; accenting everything is the bug this replaces.
    const s = replyLine('Want me to send it?')
    expect(accented(s)).toEqual([])
  })
})

describe('it never rewrites her words', () => {
  const samples = [
    "Ridgewood hasn't opened the quote yet. Want me to send a nudge?",
    'Two calls came in while you were out. Both booked, nothing needs you.',
    'I handled twenty-five conversations this month.',
    'Three leads, 2.5 hours old, and a total of $1,240. Let me know how you want to play it.',
    'Yes.',
    '',
  ]
  it.each(samples)('reproduces %j exactly', (text) => {
    expect(join(replyLine(text))).toBe(text.trim())
  })

  it('does not split a decimal or a thousands comma into its own clause', () => {
    const s = replyLine('The total is $1,240 and it took 2.5 hours. Want me to invoice it?')
    expect(accented(s)).toEqual(['Want me to invoice it?'])
    expect(join(s)).toContain('$1,240')
    expect(join(s)).toContain('2.5 hours')
  })

  it('keeps the gradient off trailing whitespace', () => {
    const s = replyLine('All done. Want me to close it?  ')
    for (const seg of s.filter((x) => x.accent)) expect(seg.text).toBe(seg.text.trimEnd())
  })
})
