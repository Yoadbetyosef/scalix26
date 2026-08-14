import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { PERSONAS } from '@/lib/persona'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const body = strip(read('./body.tsx'))
const thread = strip(read('./thread.tsx'))
const takeover = strip(read('./takeover.tsx'))
const css = read('../../v2-tokens.css')
const conv = css.slice(css.indexOf('THE CONVERSATION —'))

describe('three authors, not two', () => {
  it('the thread knows which of the two right-hand voices spoke', () => {
    // ThreadView has `them` and `us`. A thread an employee answered and a person then took over has
    // three, and collapsing the last two loses the only fact somebody opens this screen for.
    expect(thread).toContain("by: 'customer' | 'agent' | 'you'")
    expect(body).toContain("by: m.direction === 'inbound' ? 'customer' : conv.human_takeover ? 'you' : 'agent'")
  })

  it('takes C1’s values for each of the three', () => {
    expect(conv).toMatch(/\[data-by="customer"\][^}]*border-radius: 17px 17px 17px 5px/)
    expect(conv).toMatch(/\[data-by="customer"\][^}]*box-shadow: 0 1px 2px rgba\(0, 0, 0, 0\.06\)/)
    expect(conv).toMatch(/\[data-by="agent"\][^}]*background: var\(--wash\)[^}]*border-radius: 17px 17px 5px 17px/)
    expect(conv).toMatch(/\[data-by="you"\][^}]*background: var\(--v2-ink\); color: #fff/)
    expect(conv).toMatch(/\[data-by="you"\] \.v2-cwho \{ color: rgba\(255, 255, 255, 0\.5\)/)
  })

  it('labels and stamps at the reference’s sizes, right-aligned for both right-hand authors', () => {
    expect(conv).toMatch(/\.v2-cwho \{[^}]*font-size: 9px; letter-spacing: 0\.14em/)
    expect(conv).toMatch(/\.v2-cstamp \{[^}]*font-size: 9\.5px[^}]*opacity: 0\.42/)
    expect(conv).toMatch(/data-by="agent"\] \.v2-cwho,[\s\S]{0,140}text-align: right/)
  })

  it('the employee’s bubble wears THAT employee’s wash, and the file does not know which', () => {
    expect(thread).toContain("'--wash': p.wash, '--wash-ink': p.washInk")
    expect(conv).not.toMatch(/#FFEDF6|#F4FAD5/)
  })
})

describe('the wash is per persona and hand-picked', () => {
  it('carries the values it was given', () => {
    expect(PERSONAS.rudi.wash).toBe('#FFEDF6')
    expect(PERSONAS.rudi.washInk).toBe('#B0126A')
    expect(PERSONAS.miles.wash).toBe('#F4FAD5')
    expect(PERSONAS.miles.washInk).toBe('#5E6D0C')
  })

  it('says in the file why it is not a formula', () => {
    // The obvious tidy-up later is `accent at 9%`, which is a blush for magenta and a stain for acid.
    const src = read('../../../../../lib/persona/index.ts')
    expect(src).toContain('DO NOT REPLACE WITH A FORMULA')
    expect(src).toMatch(/murky stain|stain/)
  })
})

describe('the screen', () => {
  it('puts the contact strip under the header, and an absent fact is an em dash', () => {
    expect(body).toContain('className="v2-cstrip"')
    expect(body).toContain("{f.v ?? '—'}")
    expect(conv).toMatch(/\.v2-civ\[data-empty\] \{ color: var\(--v2-ink-42\)/)
  })

  it('the channel word wears the channel’s own hue, from the one table', () => {
    expect(body).toContain('<span data-channel={ch ?? undefined}>')
    expect(conv).toContain('color: var(--chan, var(--v2-ink-42))')
  })

  it('the agent pill wears the agent’s wash', () => {
    expect(body).toContain('style={{ background: persona.wash, color: persona.washInk }}')
  })

  it('separates what is true of the person from what is true of the conversation', () => {
    expect(body).toContain('THIS CONVERSATION')
    expect(body).toMatch(/const facts:/)
    expect(body).toMatch(/const about:/)
  })
})

describe('WHAT HAPPENED is a card, not an invention', () => {
  it('renders only when something written exists', () => {
    expect(body).toContain('{str(conv.summary) && (')
  })

  it('never assembles a recap from the messages', () => {
    const sum = body.slice(body.indexOf('v2-csum'), body.indexOf('v2-ctlab'))
    expect(sum).not.toMatch(/lines\[|last\.|slice\(|join\(/)
  })
})

describe('never show a composer that cannot send', () => {
  it('the swap is gated on being able to send', () => {
    expect(takeover).toContain('if (!canSend) return')
    expect(takeover).toContain('disabled={!canSend}')
  })

  it('and the preview cannot', () => {
    expect(body).toContain('canSend={false}')
  })

  it('focuses the field once it exists, not before', () => {
    expect(takeover).toContain('requestAnimationFrame(() => input.current?.focus())')
  })

  it('says what taking over costs, in the employee’s own name', () => {
    expect(takeover).toContain('{agentName} stops answering this thread.')
  })
})
