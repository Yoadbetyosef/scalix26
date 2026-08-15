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
    expect(wide).toContain('.v2 .v2-conv .v2-cstrip { display: none; }')
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
  it('takes its heading with it when there is nothing to say', () => {
    // An empty heading is worse than no heading: it says a thing exists and then fails to show it,
    // which reads as a broken screen rather than an empty one. The label is INSIDE the condition.
    const block = body.slice(body.indexOf('{str(conv.recap) && ('), body.indexOf("factGroup('CONTACT'"))
    expect(block).toContain('WHAT HAPPENED')
    expect(block.indexOf('WHAT HAPPENED')).toBeGreaterThan(block.indexOf('{str(conv.recap) && ('))
  })

  it('renders only when something written exists — and `recap` is the only thing written', () => {
    // NOT `summary`: on email that column is the subject line, so reading it here would put
    // "Re: quote for Tuesday" under a heading promising an account of what happened.
    expect(body).toContain('{str(conv.recap) && (')
    expect(body).not.toContain('{str(conv.summary) && (')
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
    expect(css).toMatch(/\.v2-conv \.v2-sec \{\s*display: none/)
    expect(wide).toContain('.v2 .v2-conv .v2-sec { display: block; }')
  })

  it('one component for both widths, not a desktop copy', () => {
    // Both sentences live in the one component and CSS shows one; a second component would be two
    // places to change the wording and two `live` states to keep in step.
    expect(takeover).toContain('className="v2-slotmsg"')
    expect(takeover).toContain('className="v2-tosub"')
    expect(css).toContain('.v2 .v2-conv .v2-slotmsg { display: none; }')
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

describe('nothing after the wide block cancels it', () => {
  // A MEDIA QUERY ADDS NO SPECIFICITY. Three rules left behind by an earlier rewrite sat AFTER
  // `@media (min-width: 1100px)` at the same (0,2,0) and won by position: `.v2-slotin` went to
  // `display: contents`, `.v2-slotmsg` to `display: none`, and a desktop rendered the phone's
  // stacked slot. Nothing was wrong inside the query — something after it was cancelling it.
  const queryStart = css.indexOf('@media (min-width: 1100px)', css.indexOf('THE CONVERSATION, WIDE'))
  const queryEnd = css.indexOf('\n}', queryStart)
  const inside = css.slice(queryStart, queryEnd)
  const after = css.slice(queryEnd)

  /** Every selector a block declares rules for, normalised. Whole selectors, not the first class in
   *  them: the fault was an IDENTICAL selector repeated later, and a more specific one that happens
   *  to mention the same class is not the same thing. */
  const selectorsIn = (block: string) =>
    new Set(
      [...block.matchAll(/(^|\n)\s*(\.v2 [^{}\n]+?)\s*\{/g)]
        .map((m) => m[2].replace(/\s+/g, ' ').trim()),
    )

  it('re-declares none of the selectors the wide block sets', () => {
    const set = selectorsIn(inside)
    const later = selectorsIn(after)
    const clashes = [...set].filter((c) => later.has(c))
    expect(clashes).toEqual([])
  })

  it('and the slot keeps its own box at every width', () => {
    // `display: contents` on the slot's inner element removes the box that carries grid-column,
    // the 64px height and the row layout all at once.
    expect(css).not.toContain('.v2-slotin { display: contents; }')
  })

  it('no rule survives for a class no component renders', () => {
    // `.v2-chd-act` outlived the markup it was written for by two commits. Comments may name it —
    // the one above this block explains what it broke — but no RULE may.
    const code = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
    expect(code).not.toContain('v2-chd-act')
  })
})

// ── THIS SECTION'S RULES MAY NOT REACH ANOTHER SCREEN ────────────────────────────────────────────
//
// `.v2-side` is this screen's sidebar. It is ALSO the home screen's right column — the third cell of
// .v2-app's `rail | 1fr | side` shell grid, in home-client.tsx and loading.tsx, and there first. One
// rule in the wide block, written `.v2 .v2-side { grid-column: 2 }` and scoped to nothing, moved that
// column out of its own 312px cell and into the CENTRE one, which is the transparent cell Rudi's
// portrait shows through. Above 1100px the home screen's cards and figures rendered on top of her
// face, scrolling over her, offset left because column three was now empty — and, `.v2-side` also
// carrying `pointer-events: auto`, swallowing every click meant for the Talk button beneath.
//
// Nothing on the home screen had changed. A rule written for this screen reached it.
//
// These class names are short and generic — .v2-f, .v2-sl, .v2-cs, .v2-hn — so the fix is the scope
// rather than the rename: `.v2 .v2-conv .v2-x` cannot match anything outside this screen, whatever
// anybody calls a class later. This asserts the scope on EVERY rule, not on the one that broke.

/** Every selector a block declares rules for, whole and comma-split. A brace scan rather than a
 *  regex: the section nests a media query, and declarations must not be mistaken for headers. */
const selectorsOf = (block: string): string[] => {
  const code = block.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const out: string[] = []
  let buf = ''
  for (const ch of code) {
    if (ch === '{') {
      const head = buf.replace(/\s+/g, ' ').trim()
      if (head && !head.startsWith('@')) out.push(...head.split(',').map((s) => s.trim()).filter(Boolean))
      buf = ''
    } else if (ch === '}') {
      buf = ''
    } else {
      buf += ch
    }
  }
  return out
}

describe('the conversation owns its own rules and nothing else’s', () => {
  // From the section's COMMENT OPENER, not from its title. The title sits inside the banner comment,
  // so slicing at it leaves an unterminated `/*` — the stripper then cannot match the block, and the
  // prose that explains this fault (which quotes the rule that caused it, braces and all) gets read
  // as CSS. The test would then fail on its own comment.
  const marker = css.indexOf('THE CONVERSATION — docs/miles/conversation-FINAL')
  const section = css.slice(css.lastIndexOf('/*', marker))

  it('declares something — otherwise the rest of this block proves nothing', () => {
    expect(selectorsOf(section).length).toBeGreaterThan(60)
  })

  it('scopes every rule under .v2-conv, so none of them can reach another screen', () => {
    const unscoped = selectorsOf(section).filter(
      (s) => s !== '.v2 .v2-conv' && !s.startsWith('.v2 .v2-conv '),
    )
    expect(unscoped).toEqual([])
  })

  it('leaves the home screen its right column', () => {
    const home = read('../../home-client.tsx')
    const loading = read('../../loading.tsx')
    // Both render the same class this screen's sidebar uses. That is the collision, and it is
    // allowed to exist — what is not allowed is a rule here that MATCHES it.
    expect(home).toContain('className="v2-side"')
    expect(loading).toContain('className="v2-side"')

    const reaching = selectorsOf(section).filter(
      (s) => /(^|\s)\.v2-side\b/.test(s) && !s.startsWith('.v2 .v2-conv '),
    )
    expect(reaching).toEqual([])
  })

  it('and the home shell still places that column third', () => {
    // The other half of the same fact: the rule stopped reaching it, and the cell it belongs in is
    // still there to hold it.
    expect(css).toContain('grid-template-columns: var(--v2-rail-w) 1fr var(--v2-side-w);')
  })
})
