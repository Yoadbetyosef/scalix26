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
//
// ── WHY POSTCSS AND NOT A BRACE COUNTER ─────────────────────────────────────────────────────────────
//
// The first version of this walked the file character by character, tracking `{`, `}` and `;`. It
// worked, and it was the fourth hand-rolled parser in a week to be wrong about something: a comment
// stripper that ate an array because `next/*` inside a `//` line looked like a block comment opening;
// a SQL scan that read the word "would" as a table name; a `sed` that cut a script block in half.
// Every one of them guessed at a grammar instead of parsing it.
//
// postcss is already how this project's CSS is built, so it is the same reader the stylesheet is
// compiled by — a brace counter can disagree with the build about what a rule is, and this cannot.
// It also removes the failure modes the hand-rolled version had no answer for: a brace or semicolon
// inside a string or a url(), a declaration with no trailing semicolon before `}`, and rules nested
// inside @media, which the very first pass skipped entirely — 175 of v2-tokens' 1,197 rules, every
// one of them behind a breakpoint, where a duplicate is hardest to spot by eye.

import { readFileSync } from 'node:fs'
import postcss from 'postcss'

export const CSS_FILES = [
  'app/(v2)/v2/v2-tokens.css',
  'app/globals.css',
  'components/dashboard/hero/amy-panel.css',
  'components/brand/ai-orb.module.css',
]

/**
 * Every style rule in a stylesheet, nested ones included.
 *
 * At-rules are containers, not rules — their children are walked in their own right, so a duplicate
 * inside `@media` is reported against the selector that carries it rather than against the query.
 */
export function parseRules(css, from = 'input.css') {
  const root = postcss.parse(css, { from })
  const rules = []
  root.walkRules((rule) => {
    rules.push({
      selector: rule.selector.replace(/\s+/g, ' ').trim(),
      line: rule.source?.start?.line ?? 0,
      decls: rule.nodes
        .filter((n) => n.type === 'decl')
        .map((d) => ({
          prop: d.prop,
          line: d.source?.start?.line ?? 0,
          text: `${d.prop}: ${d.value}${d.important ? ' !important' : ''}`,
        })),
    })
  })
  return rules
}

/**
 * Properties declared more than once in the same rule, with every occurrence.
 *
 * Compared case-insensitively on the property name, since CSS is, and a `COLOR:` shadowing a
 * `color:` is the same bug wearing a hat. Custom properties (`--x`) are compared exactly: those ARE
 * case-sensitive, and two that differ only in case are two different properties.
 */
export function findDuplicates(css, from = 'input.css') {
  const found = []
  for (const rule of parseRules(css, from)) {
    const byProp = new Map()
    for (const decl of rule.decls) {
      const key = decl.prop.startsWith('--') ? decl.prop : decl.prop.toLowerCase()
      if (!byProp.has(key)) byProp.set(key, [])
      byProp.get(key).push(decl)
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
    let dupes
    try {
      dupes = findDuplicates(css, file)
    } catch (e) {
      // A stylesheet postcss cannot read is a failure, not a pass. The brace counter this replaced
      // would have carried on and reported zero.
      console.log(`! ${file}  unparseable: ${e.message}`)
      total++
      continue
    }
    total += dupes.length
    console.log(`${dupes.length ? 'x' : 'ok'} ${file}  (${parseRules(css, file).length} rules)  ${dupes.length} duplicate${dupes.length === 1 ? '' : 's'}`)
    for (const d of dupes) {
      console.log(`    ${d.selector}  —  "${d.property}" declared ${d.occurrences.length} times`)
      for (const o of d.occurrences) console.log(`        L${o.line}  ${o.text}`)
    }
  }
  console.log(total ? `\n${total} duplicate(s). The last declaration wins; the others do nothing.` : '\nNo duplicates.')
  process.exit(total ? 1 : 0)
}
