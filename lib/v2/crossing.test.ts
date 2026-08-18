import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseCrossing, crossingCookieValue, crossingCookieCleared, crossingLabelFor, CROSSING_COOKIE, CROSSINGS } from './crossing'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

describe('the crossing survives a redirect, which ?from= does not', () => {
  it('what the writer writes, the reader reads', () => {
    // The bug this pins: crossingCookieValue ENCODES, so a reader looking the raw value up in the
    // allowlist misses every time — and misses SILENTLY. No pill, no error, no way back.
    const raw = crossingCookieValue('/v2/orders')
    const value = raw.slice(raw.indexOf('=') + 1, raw.indexOf(';'))
    expect(value).toBe(encodeURIComponent('/v2/orders'))
    expect(parseCrossing(value)).toEqual({ href: '/v2/orders', label: 'Orders' })
  })

  it('the pill names the screen, not just "back"', () => {
    expect(parseCrossing(encodeURIComponent('/v2/appointments'))?.label).toBe('Appointments')
    expect(parseCrossing(encodeURIComponent('/v2/bills'))?.label).toBe('Supplier bills')
    expect(read('../../components/classic/return-pill.tsx')).toContain('Back to {crossing.label}')
  })

  it('and only an allowlisted destination is honoured', () => {
    // The cookie decides where a pill sends somebody. An unchecked value is an open redirect in a
    // friendly hat — and "/v2/../admin" starts with /v2.
    for (const bad of ['/v2/../admin', '/dashboard', 'https://evil.example', '/v2/nope', '', null, undefined]) {
      expect(parseCrossing(bad as string | null), String(bad)).toBeNull()
    }
  })

  it('a malformed value is caught rather than trusted', () => {
    expect(parseCrossing('%E0%A4%A')).toBeNull()
  })

  it('clearing uses the same attributes — anything else leaves the cookie behind', () => {
    const set = crossingCookieValue('/v2')
    const clr = crossingCookieCleared()
    for (const attr of ['path=/', 'samesite=lax']) {
      expect(set, attr).toContain(attr)
      expect(clr, attr).toContain(attr)
    }
    expect(clr).toContain('max-age=0')
    expect(clr.startsWith(`${CROSSING_COOKIE}=;`)).toBe(true)
  })

  it('a path with no label is not worth returning to', () => {
    expect(crossingLabelFor('/v2/inbox/abc')).toBeNull()
    expect(crossingLabelFor('/v2/orders')).toBe('Orders')
  })
})

describe('the pill is rendered where it is needed', () => {
  const layout = read('../../app/layout.tsx')

  it('by the ROOT layout, so it survives every redirect and every depth', () => {
    // Somebody who crossed to create an order, was redirected to the new order, then clicked into its
    // document is three screens deep in a design they did not choose.
    expect(layout).toContain('{crossing && <ReturnPill crossing={crossing} />}')
    expect(layout).toContain('parseCrossing(')
  })

  it('and never inside /v2, where there is nothing to return from', () => {
    expect(layout).toContain("here.startsWith('/v2') ? null :")
  })

  it('read on the SERVER, so it arrives with the page', () => {
    // sessionStorage would need a client component and would appear a frame late.
    expect(layout).toContain("hdrs.get('cookie')")
  })
})

describe('no calling file names a v1 URL', () => {
  it('the destinations live in ONE place, keyed', () => {
    // The first version passed href/label as props, so every caller contained a v1 URL — which is
    // exactly what no-escape is written to catch, and it caught it. Exempting the callers would have
    // widened the hole instead of closing it.
    expect(Object.keys(CROSSINGS).sort()).toEqual(['aiEmployees', 'availability', 'catalog', 'newOrder', 'studio'])
    for (const c of Object.values(CROSSINGS)) {
      expect(c.href.startsWith('/')).toBe(true)
      expect(c.href.startsWith('/v2')).toBe(false)
      expect(c.label.length).toBeGreaterThan(0)
    }
  })

  it('and the callers pass a key, never a path', () => {
    for (const f of [
      '../../app/(v2)/v2/orders/page.tsx',
      '../../app/(v2)/v2/agents/page.tsx',
      '../../app/(v2)/v2/settings/client.tsx',
    ]) {
      const src = read(f)
      expect(src, f).toMatch(/<ClassicLink to="/)
      expect(src, f).not.toMatch(/<ClassicLink[^>]*href=/)
    }
  })

  it('the door says Classic on its face, not in a tooltip', () => {
    // A tooltip is a thing nobody reads before clicking.
    const door = read('../../app/(v2)/v2/classic-link.tsx')
    expect(door).toContain('<i>Classic</i>')
    expect(door).toContain('data-classic')
  })
})

describe('a crossing is a button that happens to leave', () => {
  const css = read('../../app/(v2)/v2/v2-tokens.css')

  it('it INHERITS the header-action rule rather than restating it', () => {
    // The first version wrote its own block and got a dashed border, a column layout and a second
    // font size that matched nothing else on the screen. A control that looks unlike every button
    // beside it reads as broken, not as deliberate.
    expect(css).toMatch(/\.v2 \.v2-hact,\s*\n\.v2 \.v2-classic \{/)
    expect(css).toMatch(/\.v2 \.v2-hact:hover,\s*\n\.v2 \.v2-classic:hover/)
  })

  it('and its own block restates NO geometry', () => {
    // Padding, radius, font-size, display — all of it comes from the shared rule. Anything here is a
    // second source of truth for how a button is shaped.
    // The BUTTON's own declaration only — not the `i` chip beside it, which is a chip and is
    // entitled to its own padding and radius.
    const decl = '.v2 .v2-classic { text-decoration: none; }'
    expect(css).toContain(decl)
    for (const prop of ['padding:', 'border-radius:', 'font-size:', 'display:']) {
      expect(decl, prop).not.toContain(prop)
    }
  })

  it('the rule is written where the next person will read it', () => {
    expect(css).toContain('A CROSSING BUTTON IS A BUTTON THAT HAPPENS TO LEAVE')
    expect(css).toContain('Do not write a new block')
  })

  it('the why line is a SIBLING of the button', () => {
    // A button containing a paragraph stops being the same shape as the buttons beside it.
    const door = read('../../app/(v2)/v2/classic-link.tsx')
    expect(door).toMatch(/<\/a>[\s\S]{0,300}v2-classic-why/)
  })
})
