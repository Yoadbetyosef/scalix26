import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// NO SERVER ROUTE MAY CALL A VALUE IMPORTED FROM A 'use client' MODULE.
//
// A Server Component importing from a client module gets CLIENT REFERENCE PROXIES, not the real
// exports. Rendering them as components is fine; calling a function export is not — the proxy is not a
// function and it throws inside the Server Components render, where production strips the message and
// leaves only a digest.
//
// This class is invisible to tsc (an ordinary function export) and to next build (the rule is enforced
// at runtime). It took down four screens at once and every gate stayed green, so the check has to live
// here.

const V2 = join(process.cwd(), 'app/(v2)/v2')

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((e) => {
    const full = join(dir, e)
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.tsx') || full.endsWith('.ts') ? [full] : []
  })

const files = walk(V2).filter((f) => !f.includes('.test.'))
const read = (f: string) => readFileSync(f, 'utf8')
const isClient = (f: string) => read(f).trimStart().startsWith("'use client'")
const rel = (f: string) => f.slice(V2.length + 1)

describe('the client boundary', () => {
  // Every server file in /v2, and the local modules it imports from.
  const serverFiles = files.filter((f) => !isClient(f))

  it('has server files to check', () => {
    expect(serverFiles.length).toBeGreaterThan(5)
  })

  it.each(serverFiles.map((f) => [rel(f), f]))('%s calls nothing imported from a client module', (_name, file) => {
    const src = read(file)
    for (const m of src.matchAll(/import\s+\{([^}]+)\}\s+from\s+'(\.[^']+)'/g)) {
      const target = files.find((f) => {
        const base = join(file, '..', m[2])
        return f === `${base}.ts` || f === `${base}.tsx` || f === join(base, 'index.ts')
      })
      if (!target || !isClient(target)) continue

      for (const raw of m[1].split(',')) {
        const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()!.trim()
        // A type import is erased and a component is rendered, never called. What must not appear is
        // the identifier followed by an opening bracket.
        if (!name || /^type\s/.test(raw.trim())) continue
        if (/^[A-Z]/.test(name)) continue // a component, rendered as JSX
        expect(
          new RegExp(`\\b${name}\\s*\\(`).test(src),
          `${rel(file)} calls ${name}() imported from the client module ${rel(target)} — on the server that is a proxy, not a function`,
        ).toBe(false)
      }
    }
  })
})
