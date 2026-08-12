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
    expect(src).toMatch(/const toggleTalk = useCallback\(\(\) => \{ wake\(\); amy\.goLive\(\) \}/)
    // Every Talk affordance routes through toggleTalk, so the unlock always happens inside the click.
    expect(src.match(/amy\.goLive\(\)/g) ?? []).toHaveLength(1)
  })
})
