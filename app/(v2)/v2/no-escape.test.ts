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

const V2 = join(process.cwd(), 'app/(v2)/v2')

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((e) => {
    const full = join(dir, e)
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(full) ? [full] : []
  })

const files = walk(V2).filter((f) => !f.includes('.test.') && !f.endsWith('.md'))

// An absolute app path that is not under /v2. Relative hrefs and external URLs are not this fault.
const OUTSIDE = /(?:href:\s*|href=\{?["'`]|href="|`)(\/(?!v2\/|v2["'`\s]|auth\/)[a-z][a-z0-9-]*(?:\/|["'`]))/g

describe('no row leaves the preview', () => {
  it.each(files.map((f) => [f.slice(V2.length + 1), f]))('%s links nowhere outside /v2', (_name, file) => {
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ')
    const hits = [...src.matchAll(OUTSIDE)].map((m) => m[1])
    expect(
      hits,
      `${file.slice(V2.length + 1)} links out of the preview: ${hits.join(', ')} — a destination that does not exist yet must be inert, not a link to the old app`,
    ).toEqual([])
  })
})
