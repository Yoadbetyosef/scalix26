import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { PERSONAS } from '@/lib/persona'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const body = strip(read('./body.tsx'))
const thread = strip(read('./thread.tsx'))
const takeover = strip(read('./takeover.tsx'))
const css = read('../../v2-tokens.css')
const conv = css.slice(css.indexOf('THE CONVERSATION — docs/miles/conversation-FINAL'))
// The wide arrangement is the same DOM, and its block starts where the phone's ends.
const wide = css.slice(css.indexOf('THE CONVERSATION, WIDE'))

describe('three authors, not two', () => {
  it('the thread knows which of the two right-hand voices spoke', () => {
    // ThreadView has `them` and `us`. A thread an employee answered and a person then took over has
    // three, and collapsing the last two loses the only fact somebody opens this screen for.
    expect(thread).toContain("by: 'customer' | 'agent' | 'you'")
    expect(body).toContain("by: m.role === 'user' ? 'customer' : m.role === 'agent' ? 'you' : 'agent'")
  })

  it('takes the final file’s values for each of the three', () => {
    expect(conv).toMatch(/\.v2-cb \{ max-width: 78%; padding: 11px 15px; font-size: 14\.5px; line-height: 1\.48/)
    expect(conv).toMatch(/\[data-by="customer"\][^}]*border-radius: 18px 18px 18px 6px/)
    expect(conv).toMatch(/\[data-by="customer"\][^}]*box-shadow: 0 1px 2px rgba\(0, 0, 0, 0\.055\)/)
    expect(conv).toMatch(/\[data-by="agent"\][^}]*background: var\(--wash\)[^}]*border-radius: 18px 18px 6px 18px/)
    expect(conv).toMatch(/\[data-by="you"\][^}]*background: var\(--v2-ink\); color: #fff/)
    expect(conv).toMatch(/\[data-by="you"\] \.v2-cwho \{ color: rgba\(255, 255, 255, 0\.5\)/)
  })

  it('a run of one author drops its label and closes the gap', () => {
    // Two bubbles, one label — which is what makes it read as a conversation rather than a list.
    expect(thread).toContain('const run = !!prev && !newDay && prev.by === l.by')
    expect(thread).toContain('{!run && <p className="v2-cwho">{label}</p>}')
    expect(conv).toMatch(/\.v2-cb\[data-run\] \{ margin-top: -4px; \}/)
  })

  it('labels and stamps at the reference’s sizes, right-aligned for both right-hand authors', () => {
    expect(conv).toMatch(/\.v2-cwho \{[^}]*font-size: 9px; letter-spacing: 0\.14em[^}]*margin-bottom: 6px/)
    expect(conv).toMatch(/\.v2-cstamp \{[^}]*font-size: 9\.5px[^}]*margin-top: 6px; opacity: 0\.42/)
    expect(conv).toMatch(/\[data-by="agent"\] \.v2-cwho \{ color: var\(--wash-ink\); text-align: right/)
    expect(conv).toMatch(/\[data-by="you"\] \.v2-cwho \{ color: rgba\(255, 255, 255, 0\.5\); text-align: right/)
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
  it('the strip is a phone pattern and stops at 1100px', () => {
    // Above it the sidebar carries every fact on the strip, and a screen that says everything twice
    // trusts neither copy.
    expect(body).toContain('className="v2-cstrip"')
    expect(body).toContain("{f.v ?? '—'}")
    expect(conv).toMatch(/\.v2-civ\[data-empty\] \{ color: var\(--v2-ink-24\)/)
    expect(wide).toContain('.v2 .v2-cstrip { display: none; }')
  })

  it('the channel word wears the channel’s own hue, from the one table', () => {
    // As TEXT on white it takes --chan-ink: cyan and amber at full strength are unreadable there.
    expect(body).toContain('<span className="v2-c" data-channel={ch ?? undefined}>')
    expect(conv).toContain('.v2-hm .v2-c { color: var(--chan-ink, var(--v2-ink-42)); font-weight: 500; }')
  })

  it('the agent pill wears the agent’s wash', () => {
    expect(body).toContain('style={{ background: persona.wash, color: persona.washInk }}')
  })

  it('separates what is true of the person from what is true of the conversation', () => {
    expect(body).toContain('THIS CONVERSATION')
    expect(body).toMatch(/const person:/)
    expect(body).toMatch(/const about:/)
  })
})

describe('WHAT HAPPENED is a card, not an invention', () => {
  it('renders only when something written exists', () => {
    expect(body).toContain('{str(conv.summary) && (')
  })

  it('never assembles a recap from the messages', () => {
    const sum = body.slice(body.indexOf('WHAT HAPPENED'), body.indexOf("factGroup('CONTACT'"))
    expect(sum).not.toMatch(/lines\[|last\.|join\(/)
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

  it('one 1076px container, a 720 column and a 320 sidebar', () => {
    expect(wide).toMatch(/--col: 720px; --side: 320px; --cgap: 36px; --cwrap: 1076px/)
    expect(wide).toMatch(/grid-template-columns: var\(--col\) var\(--side\); gap: var\(--cgap\)/)
    // The header row uses the same container, so nothing on the screen is aligned to the window.
    expect(wide).toMatch(/\.v2-hin \{ width: min\(var\(--cwrap\), 100%\)/)
  })

  it('carries three headings, not one grid', () => {
    // The person and the conversation are different kinds of fact; a single grid asks the reader to
    // sort them.
    expect(body).toContain("factGroup('CONTACT', person)")
    expect(body).toContain("factGroup('THIS CONVERSATION', about)")
    expect(body).toContain('WHAT HAPPENED')
  })

  it('take over is a slot at the foot of the thread, not a header action', () => {
    // It is the primary thing on this screen; a copy beside the secondary actions would compete with
    // itself. Still ONE <TakeOver> — two would be two `live` states, and the hidden one falls out of
    // step.
    expect((body.match(/<TakeOver /g) ?? []).length).toBe(1)
    expect(body.indexOf('<TakeOver')).toBeGreaterThan(body.indexOf('v2-cscr'))
  })

  it('the slot is one 64px row, in the thread’s column only', () => {
    // grid-column 1, so it ends where the messages end rather than running under the sidebar. That
    // was the fault: a slot centred in the window is not aligned to anything on the page.
    expect(wide).toMatch(/\.v2-slotin \{\s*grid-column: 1; grid-row: 1;\s*height: 64px/)
    expect(takeover).toContain('<div className="v2-wrap">')
  })

  it('the slot sits outside the scroller, so it holds while the thread moves', () => {
    // A sibling of the scroller, after it — a child would scroll away.
    expect(body.indexOf('<TakeOver')).toBeGreaterThan(body.indexOf('v2-wrap'))
    expect(css).toMatch(/\.v2-cmp \{\s*flex: none/)
  })

  it('the status line is quiet — only the name is in ink', () => {
    expect(wide).toMatch(/\.v2-slotmsg \{ display: block; flex: 1; font-size: 13px; line-height: 1\.4; color: var\(--v2-ink-42\)/)
    expect(wide).toMatch(/\.v2-slotmsg b \{ color: var\(--v2-ink\); font-weight: 500/)
  })

  it('the secondary actions stay in the header, and say they are not wired', () => {
    expect(body).toMatch(/className="v2-sec" disabled title=\{PREVIEW\}>Resolve</)
    expect(body).toMatch(/className="v2-sec" disabled title=\{PREVIEW\}>Close</)
    // A phone header has no room for them, and they are not the primary thing anywhere.
    expect(css).toMatch(/\.v2-sec \{\s*display: none/)
    expect(wide).toContain('.v2 .v2-sec { display: block; }')
  })

  it('one component for both widths, not a desktop copy', () => {
    // Both sentences live in the one component and CSS shows one; a second component would be two
    // places to change the wording and two `live` states to keep in step.
    expect(takeover).toContain('className="v2-slotmsg"')
    expect(takeover).toContain('className="v2-tosub"')
    expect(css).toContain('.v2 .v2-slotmsg { display: none; }')
  })

  it('the sidebar blocks are the same nodes the phone stacks', () => {
    // One render, placed by the grid. Written FIRST so a phone reads WHAT HAPPENED before the
    // thread; placed second so a desktop puts it beside one.
    expect((body.match(/factGroup\(/g) ?? []).length).toBe(2)
    expect(body).toContain('className="v2-side"')
    expect(body.indexOf('v2-side')).toBeLessThan(body.indexOf('v2-tcol'))
    expect(wide).toMatch(/\.v2-side \{ grid-column: 2; grid-row: 1; \}/)
    expect(wide).toMatch(/\.v2-tcol \{ grid-column: 1; grid-row: 1; \}/)
  })

  it('is entirely inside a min-width query — the phone layout is untouched', () => {
    expect(wide).toContain('@media (min-width: 1100px)')
    const inside = wide.slice(wide.indexOf('@media (min-width: 1100px) {'))
    expect((inside.match(/\{/g) ?? []).length).toBe((inside.match(/\}/g) ?? []).length)
  })
})
