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
    expect(body).toContain("by: m.role === 'user' ? 'customer' : m.role === 'agent' ? 'you' : 'agent'")
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
    expect(body).toContain('const whatHappened = str(conv.summary) ? (')
  })

  it('never assembles a recap from the messages', () => {
    const sum = body.slice(body.indexOf('v2-csum'), body.indexOf('v2-ctlab'))
    expect(sum).not.toMatch(/lines\[|last\.|slice\(|join\(/)
  })
})

describe('the composer can send, and says truthfully whether it did', () => {
  it('takes over FIRST — /send refuses without it', () => {
    const to = takeover.indexOf('/takeover')
    const sd = takeover.indexOf('/send')
    expect(to).toBeGreaterThan(-1)
    expect(to).toBeLessThan(sd)
  })

  it('never reports success on ok: true alone', () => {
    // Five paths return ok:true with delivered:false — a paused partner, no phone on file, a mailbox
    // needing reconnect, an unsupported channel, a provider that threw. Reading the status code is
    // the Send-to-Production bug: a success message over a send that reached nobody.
    expect(takeover).toContain('j.delivered')
    expect(takeover).toContain("? { ok: true, message: 'Sent.' }")
  })

  it('shows the route’s own note when it did not reach them', () => {
    expect(takeover).toContain("{ ok: false, message: j.note || 'Saved to the thread, but not delivered.' }")
  })

  it('does not clear the failure when the next attempt starts, silently', () => {
    // setOutcome(null) happens at the start of an attempt — deliberate — but the failure stays on
    // screen until then rather than fading like a toast.
    expect(takeover).toContain('setOutcome(null)')
  })

  it('refreshes so the thread shows what was actually recorded', () => {
    expect((takeover.match(/router\.refresh\(\)/g) ?? []).length).toBe(2)   // after takeover, after send
  })

  it('focuses the field once it exists, not before', () => {
    expect(takeover).toContain('requestAnimationFrame(() => input.current?.focus())')
  })

  it('says what taking over costs, in the employee’s own name', () => {
    expect(takeover).toContain('${agentName} stops answering this thread.')
  })

  it('opens straight into the composer on a thread already taken over', () => {
    expect(takeover).toContain('useState(takenOver)')
    expect(body).toContain('takenOver={conv.human_takeover === true}')
  })
})

describe('desktop', () => {
  const wide = css.slice(css.indexOf('THE CONVERSATION ON A WIDE SCREEN'))

  it('caps the thread at 720px and puts the sidebar at 320px', () => {
    expect(wide).toMatch(/grid-template-columns: minmax\(0, 720px\) 320px/)
  })

  it('carries three headings, not one grid', () => {
    // The person and the conversation are different kinds of fact; a single grid asks the reader to
    // sort them.
    expect(body).toContain("factList('CONTACT', facts)")
    expect(body).toContain("factList('THIS CONVERSATION', about)")
    expect(body).toContain('{whatHappened}')
  })

  it('moves the action into the header rather than rendering a second one', () => {
    // Two <TakeOver>s would be two `live` states, and the hidden one is the one that falls out of
    // step. The header placement is a grid area on the single node.
    expect((body.match(/<TakeOver /g) ?? []).length).toBe(1)
    expect(wide).toMatch(/grid-template-areas: "head act" "strip strip" "scroll scroll"/)
    expect(wide).toMatch(/\.v2-conv > \.v2-cmp \{\s*grid-area: act/)
  })

  it('the sidebar blocks are the same nodes the phone stacks', () => {
    // One render, placed by CSS. Two copies of a list are two lists to keep in step.
    expect((body.match(/factList\(/g) ?? []).length).toBe(2)   // two calls; the definition is `factList = (`
    expect(body).toContain('className="v2-cside"')
  })

  it('is entirely inside a min-width query — the phone layout is untouched', () => {
    expect(wide).toContain('@media (min-width: 1100px)')
    const inside = wide.slice(wide.indexOf('@media (min-width: 1100px) {'))
    expect((inside.match(/\{/g) ?? []).length).toBe((inside.match(/\}/g) ?? []).length)
  })
})
