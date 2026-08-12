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
  it('renders the hero and the voice panel exactly ONCE', () => {
    // This assertion inverted with the hoist, and the old one was hiding the bug it was written for.
    // Two mounts meant one per branch, which meant the canvas lived at a different position in each —
    // so any branch change destroyed it and rebuilt the WebGL context, the mesh, the still and the
    // video. One mount in one stable parent is what makes that impossible.
    expect(src.match(/\{amyLayer\}/g) ?? []).toHaveLength(1)
    expect(src.match(/\{hero\}/g) ?? []).toHaveLength(1)
  })

  it('mounts it as child 0 of a root that never changes', () => {
    // The root renders in every mode, including before the breakpoint resolves, and the hero is its
    // first child. Neither the mode nor the branch can move it.
    expect(src).toMatch(/<div className="v2-root" data-mode=\{mode\}[\s\S]{0,120}<div className="v2-hero">\s*\n\s*\{hero\}\s*\n\s*\{amyLayer\}/)
    // And the chrome is a sibling of the hero, never its parent.
    expect(src).toMatch(/\{mode === 'desktop' && \(/)
    expect(src).toMatch(/\{mode === 'mobile' && \(/)
  })

  it('still has exactly one canvas, so the ref stays unambiguous', () => {
    // use-breakpoint.ts rejected "one tree plus CSS" because two canvases both called
    // useImperativeHandle on one ref and the hidden one won. The hoist keeps one hero, not two.
    expect(src.match(/<RudiCanvas/g) ?? []).toHaveLength(1)
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
