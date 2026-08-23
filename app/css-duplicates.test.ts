import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CSS_FILES, findDuplicates, parseRules } from '../scripts/find-css-duplicates.mjs'

// No stylesheet may declare the same property twice in the same rule.
//
// The bug that prompted this: `.v2-scrim` had `transition: height 0.4s var(--v2-ease)` and, two lines
// below it, `transition: opacity 0.35s`. The second won. The veil's height snapped between 36% and
// 48% for months and nobody saw it, because a property that silently stops applying looks exactly
// like a property that was never asked for.
//
// There is no allowlist. The one other duplicate this found — the linear-then-radial `background` on
// `.v2-talk` — went out in the same commit as this test: the linear was dead in every browser that
// can draw a radial, and its presence is why `.v2-talk[data-on]` had to write `background-image: none`
// to get its glass. A dead fallback is not free; it becomes a fact later rules have to know.
//
// If you ever need a real capability fallback, write `@supports`. It states the condition out loud
// and it can be tested; two bare declarations state nothing and can only be read as an accident.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')

describe('no CSS rule declares the same property twice', () => {
  it.each(CSS_FILES)('%s', (file) => {
    const dupes = findDuplicates(read(file))
    const report = dupes
      .map((d) => `${d.selector} — "${d.property}":\n` + d.occurrences.map((o) => `    L${o.line}  ${o.text}`).join('\n'))
      .join('\n')
    expect(report).toBe('')
  })

  it('covers every stylesheet in the app, so a new one cannot slip past unchecked', () => {
    // Kept as a literal list rather than a glob: a glob would silently start covering vendor or
    // generated CSS, and the failure mode of THIS test is a file nobody added to it.
    expect(CSS_FILES).toHaveLength(4)
    for (const f of CSS_FILES) expect(() => read(f)).not.toThrow()
  })
})

describe('the parser, proved against the bug it was written for', () => {
  // The real `.v2-scrim`, as it stood at 10e6ad1~1. Kept as a fixture rather than as a comment so
  // that a rewrite of the parser has to keep catching it.
  const PRE_FIX_SCRIM = `
.v2-scrim {
  position: absolute; left: 0; right: 0; bottom: 0; height: 62%; z-index: 2; pointer-events: none;
  transition: height 0.4s var(--v2-ease);
  background: linear-gradient(180deg, rgba(10, 10, 13, 0) 0%, rgba(10, 10, 13, 0.92) 100%);
  transition: opacity 0.35s;
}`

  it('finds the transition that was overwritten', () => {
    const [dupe, ...rest] = findDuplicates(PRE_FIX_SCRIM)
    expect(rest).toEqual([])
    expect(dupe.selector).toBe('.v2-scrim')
    expect(dupe.property).toBe('transition')
    expect(dupe.occurrences.map((o) => o.text)).toEqual([
      'transition: height 0.4s var(--v2-ease)',
      'transition: opacity 0.35s',
    ])
  })

  it('looks inside @media, where a flat scan does not', () => {
    // The first version of this sweep treated `@media` as the rule and never descended. It reported
    // v2-tokens as 1,022 rules; the real number is 1,197, and the 175 it skipped are precisely the
    // ones behind a breakpoint — where a duplicate is hardest to spot by eye.
    const nested = `@media (max-width: 700px) { .a { color: red; color: blue; } }`
    expect(findDuplicates(nested)).toHaveLength(1)
    expect(findDuplicates(nested)[0].property).toBe('color')
    expect(parseRules(nested).map((r) => r.selector)).toEqual(['.a'])
  })

  it('does not mistake a longhand beside its shorthand for a duplicate', () => {
    // `background` then `background-image` IS a reset worth knowing about, but they are two different
    // properties and this test is not the place that claims otherwise.
    expect(findDuplicates(`.a { background: red; background-image: none; }`)).toEqual([])
  })

  it('does not trip over a declaration inside a comment, or a missing final semicolon', () => {
    expect(findDuplicates(`.a { color: red; /* color: blue; */ }`)).toEqual([])
    expect(findDuplicates(`.a { color: red; color: blue }`)).toHaveLength(1)
  })
})
