#!/usr/bin/env node
// One property, declared twice in one rule, where the second silently wins.
//
// This exists because `.v2-scrim` carried `transition: height 0.4s` and `transition: opacity 0.35s`
// two lines apart. The second won, the first never applied, and the veil's height snapped instead of
// animating for months — invisible, because nobody had reason to watch that property change. The
// fixture in the test beside this file is that exact rule, kept so the next person can see the tool
// was proved against a real bug rather than written against a hypothetical one.
//
// A duplicate is ALWAYS a mistake here, including the old-browser fallback pattern
// (`background: linear-gradient(…)` then `background: radial-gradient(…)`). Every browser this app
// supports draws both, so the first line is dead weight that later rules then have to work around —
// the radial fallback on .v2-talk is why `.v2-talk[data-on]` once needed `background-image: none`.
// If you genuinely need a capability fallback, write @supports; it says so out loud and it is testable.

import { readFileSync } from 'node:fs'

export const CSS_FILES = [
  'app/(v2)/v2/v2-tokens.css',
  'app/globals.css',
  'components/dashboard/hero/amy-panel.css',
  'components/brand/ai-orb.module.css',
]

/**
 * Every rule in a stylesheet, nested ones included.
 *
 * Brace-tracked rather than regex-matched: rules inside `@media` are nested one level deeper, and a
 * flat scan reports them as part of the media block and never looks inside. A first pass at this
 * missed 175 of v2-tokens' 1,197 rules that way — every one behind a breakpoint.
 */
export function parseRules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  const rules = []
  const stack = []
  let token = ''
  let line = 1
  const flush = () => {
    const top = stack[stack.length - 1]
    if (top && token.trim()) top.decls.push({ line, text: token.trim() })
    token = ''
  }
  for (const ch of src) {
    if (ch === '\n') line++
    if (ch === '{') {
      stack.push({ selector: token.trim().replace(/\s+/g, ' '), line, decls: [] })
      token = ''
    } else if (ch === '}') {
      flush()
      const rule = stack.pop()
      // @media / @supports / @keyframes are containers, not rules; their children are already pushed.
      if (rule && !rule.selector.startsWith('@')) rules.push(rule)
    } else if (ch === ';') {
      flush()
    } else {
      token += ch
    }
  }
  return rules
}

/** Properties declared more than once in the same rule, with every occurrence. */
export function findDuplicates(css) {
  const found = []
  for (const rule of parseRules(css)) {
    const byProp = new Map()
    for (const decl of rule.decls) {
      const name = decl.text.match(/^([-a-zA-Z]+)\s*:/)?.[1]
      if (!name) continue
      if (!byProp.has(name)) byProp.set(name, [])
      byProp.get(name).push(decl)
    }
    for (const [property, occurrences] of byProp) {
      if (occurrences.length > 1) found.push({ selector: rule.selector, line: rule.line, property, occurrences })
    }
  }
  return found
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let total = 0
  for (const file of CSS_FILES) {
    const css = readFileSync(file, 'utf8')
    const dupes = findDuplicates(css)
    total += dupes.length
    console.log(`${dupes.length ? '✗' : '✓'} ${file}  (${parseRules(css).length} rules)  ${dupes.length} duplicate${dupes.length === 1 ? '' : 's'}`)
    for (const d of dupes) {
      console.log(`    ${d.selector}  —  "${d.property}" declared ${d.occurrences.length} times`)
      for (const o of d.occurrences) console.log(`        L${o.line}  ${o.text}`)
    }
  }
  console.log(total ? `\n${total} duplicate(s). The last declaration wins; the others do nothing.` : '\nNo duplicates.')
  process.exit(total ? 1 : 0)
}
