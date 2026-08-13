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

describe('one channel mapping, used everywhere', () => {
  const css = readFileSync(join(V2, 'v2-tokens.css'), 'utf8')
  const channels = readFileSync(join(V2, 'channels.ts'), 'utf8')

  it('the hue is declared once, on data-channel, not per component', () => {
    // A second table would drift. The list mark, the detail chip and the thread meta all read --chan.
    for (const c of ['voice', 'sms', 'email', 'facebook', 'instagram', 'web']) {
      const at = css.indexOf(`[data-channel="${c}"]`)
      expect(at, `no hue declared for ${c}`).toBeGreaterThan(-1)
      expect(css.slice(at, css.indexOf('}', at))).toMatch(/--chan: #[0-9a-f]{6}/i)
    }
  })

  it('every channel gets the same shape and weight, only the hue differs', () => {
    const mark = css.slice(css.indexOf('.v2 .v2-chan {'), css.indexOf('}', css.indexOf('.v2 .v2-chan {')))
    expect(mark).toMatch(/width: 10px; height: 10px/)
    expect(mark).toMatch(/background: var\(--chan/)
    // The halo is what makes it read at arm's length rather than being something to look for.
    expect(mark).toMatch(/box-shadow: 0 0 0 3px/)
  })

  it('channels.ts stays callable from the server', () => {
    // The DIRECTIVE, not the words — the file's own header explains why it has none.
    expect(channels.trimStart().startsWith("'use client'")).toBe(false)
    expect(channels).toMatch(/export const CHANNEL_LABEL/)
  })
})
