import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// NOTHING IN /v2 LINKS OUT OF /v2.
//
// A row that leaves for the old app is a dead end in one tap, and on a phone the sheet is the only way
// back. I fixed this for inbox, then contacts, then orders — and reintroduced it on the agents list in
// the same commit as the third fix. Memory is not the control; this is.
//
// A destination that does not exist yet must be INERT (href: null, or a disabled button), never a link
// to the old app.
//
// ── WHAT THIS FORBIDS, AND WHAT IT DOES NOT ─────────────────────────────────────────────────────
//
// READ THIS BEFORE WIDENING ANYTHING. The rule is not "never link out of /v2". It is: a row must not
// leave the preview WITHOUT SAYING SO. Those are different, and the earlier version of this file read
// like the first, which is why it is written down now.
//
// A list row pointing at /dashboard is the fault: it looks like every other row, it is a dead end in
// one tap on a phone, and the sheet is the only way back. Caught three times — inbox, contacts,
// orders — and reintroduced on the agents list in the same commit as the third fix.
//
// A control that announces the crossing is not that fault. `<ClassicLink>` says "Classic" on its own
// face, sets a cookie so the way back is named on every screen it lands on, and is the ONLY component
// allowed to carry an outbound href — enforced by `data-classic` below rather than by another path
// exclusion, so a second door cannot be opened by adding a second exception.

const V2 = join(process.cwd(), 'app/(v2)/v2')

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((e) => {
    const full = join(dir, e)
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(full) ? [full] : []
  })

const files = walk(V2).filter((f) => !f.includes('.test.') && !f.endsWith('.md'))

// An absolute app path that is not under /v2. Relative hrefs and external URLs are not this fault.
//
// `/api/` is excluded for the same reason `/auth/` already was: neither is a DESTINATION. This guard
// exists because a row that navigates out of the preview is a dead end in one tap on a phone — an
// endpoint a button posts to is data, and never somewhere a person lands.
//
// It also watches router.push/replace. It did not, and this screen navigates ONLY that way — a guard
// that covers hrefs while the code has moved to programmatic navigation is a guard that passes
// because it is looking somewhere else. Verified by mutation: pointing a row at /dashboard fails.
//
// `/i/` is excluded on the same grounds: it is the CUSTOMER's copy of an invoice, a session-less token
// page opened in a new tab. It is not a destination inside the app at all, so the /v2 tab the owner is
// standing in never moves and there is no dead end to come back from. (`i/` only matches when the very
// next character is a slash — a future `/inbox/` would still be caught.)
const OUTSIDE = /(?:href:\s*|href=\{?["'`]|href="|router\.(?:push|replace)\(\s*["'`]|`)(\/(?!v2\/|v2["'`\s]|auth\/|api\/|i\/)[a-z][a-z0-9-]*(?:\/|["'`]))/g

/**
 * The declared crossing. An element carrying `data-classic` may hold an outbound href, because it
 * tells the person where it goes and leaves them a named way back.
 *
 * Matched on the FILE rather than the line: JSX puts the attribute and the href on separate lines,
 * and a line-scoped rule would be defeated by formatting. The narrowness comes from the companion
 * test below — only ONE file may carry it — not from the regex.
 */
const DECLARES_CROSSING = /data-classic/

describe('no row leaves the preview', () => {
  it.each(files.map((f) => [f.slice(V2.length + 1), f]))('%s links nowhere outside /v2', (_name, file) => {
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ')
    // A file that declares the crossing is exempt — see the header. Every other file must be silent.
    const hits = DECLARES_CROSSING.test(src) ? [] : [...src.matchAll(OUTSIDE)].map((m) => m[1])
    expect(
      hits,
      `${file.slice(V2.length + 1)} links out of the preview: ${hits.join(', ')} — a destination that does not exist yet must be inert, not a link to the old app. If it is a deliberate crossing, use <ClassicLink>, which carries data-classic and leaves a way back.`,
    ).toEqual([])
  })

  it('and only ONE file may declare a crossing', () => {
    // The exemption is the component, not the attribute. If any file could opt out by typing
    // `data-classic`, the guard would be advisory — and the next person who wants to link to v1
    // would type it rather than route through the door that leaves a way back.
    const declaring = files.filter((f) => DECLARES_CROSSING.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(V2.length + 1))
    expect(declaring).toEqual(['classic-link.tsx'])
  })

  it('the crossing leaves a way back before it navigates', () => {
    // ?from= does NOT survive: order-form.tsx pushes `/orders/${id}` with no params, catalog/new
    // REPLACES them with ?created=1, landed-cost uses window.location.href — and none of those
    // targets reads searchParams. The cookie is what makes the pill survive the redirect, which is
    // the moment it matters most.
    const src = readFileSync(join(V2, 'classic-link.tsx'), 'utf8')
    expect(src).toContain('crossingCookieValue(from)')
    expect(src).toContain('data-classic')
    // Set synchronously in the click, before the navigation request leaves.
    expect(src).toMatch(/onClick=\{\(\) => \{[\s\S]*document\.cookie/)
  })
})
