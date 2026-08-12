import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// /v2 renders two trees — desktop (.v2-stage) and mobile (.v2-frame) — chosen by useIsMobile().
// Anything the Talk button opens has to be mounted in BOTH. It was not: moving the panel out of the
// shell grid re-added it to the mobile frame only, so on desktop goLive() ran, the session opened, the
// AudioContext unlocked, and nothing rendered it. The button looked dead and every hypothesis pointed
// at the audio path.
//
// A count, not a search: "it appears somewhere" was true the whole time it was broken.

const src = readFileSync(join(process.cwd(), 'app/(v2)/v2/home-client.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

describe('both /v2 trees mount the voice panel', () => {
  it('renders amyLayer exactly twice — once per tree', () => {
    expect(src.match(/\{amyLayer\}/g) ?? []).toHaveLength(2)
  })

  it('mounts one inside the desktop stage and one inside the mobile frame', () => {
    expect(src).toMatch(/<main className="v2-stage"[\s\S]{0,220}\{amyLayer\}/)
    expect(src).toMatch(/<div className="v2-frame">[\s\S]{0,80}\{amyLayer\}/)
  })

  it('both trees drive the same session — one goLive, from one handler', () => {
    expect(src.match(/amy\.goLive\(\)/g) ?? []).toHaveLength(1)
    const t = src.slice(src.indexOf('const toggleTalk'), src.indexOf('useEffect', src.indexOf('const toggleTalk')))
    expect(t).toMatch(/amy\.goLive\(\)/)
  })

  it('a second press ends the session instead of opening another', () => {
    const t = src.slice(src.indexOf('const toggleTalk'), src.indexOf('useEffect', src.indexOf('const toggleTalk')))
    expect(t).toMatch(/amy\.mode !== 'idle'/)
    expect(t).toMatch(/amy\.close\(\)/)
  })

  it('the custom cursor is off while a session is open', () => {
    // The TALK ring drew on top of the panel and across her face mid-call.
    expect(src).toMatch(/active=\{!typing && amy\.mode === 'idle'\}/)
  })
})
