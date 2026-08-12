import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Assigning canvas.width clears every pixel and resets the 2D context — even when the value is
// unchanged. So fit() is not free, and calling it on an already-sized canvas is a blank frame.
// A mouse move did exactly that and blacked the screen.

const src = readFileSync(join(process.cwd(), 'app/(v2)/v2/rudi-canvas.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

describe('resizing the canvas cannot blank it', () => {
  it('fit() measures before it assigns, and bails when the size is unchanged', () => {
    const fit = src.slice(src.indexOf('function fit()'), src.indexOf('function ensureNet()'))
    // The guard must come BEFORE the assignment, or the wipe has already happened.
    const guard = fit.indexOf('if (w === CW && h === CH) return')
    const assign = fit.indexOf('canvas!.width = CW')
    expect(guard).toBeGreaterThan(-1)
    expect(assign).toBeGreaterThan(guard)
  })

  it('the loop redraws the still every frame rather than trusting a one-time paint', () => {
    const draw = src.slice(src.indexOf('function draw(now: number)'), src.indexOf('function drawStill()'))
    expect(draw).toMatch(/drawImage\(img, DX, DY, DW, DH\)/)
  })

  it('a missing still does not kill the loop', () => {
    // Returning without re-requesting a frame ended it permanently, so anything that cleared the
    // canvas before the image was ready left it black with nothing scheduled to repaint.
    expect(src).toMatch(/if \(!img\) \{ raf = requestAnimationFrame\(draw\); return \}/)
  })

  it('the first-interaction handler repaints when the loop is not running', () => {
    const kick = src.slice(src.indexOf('const kick = ()'), src.indexOf('KICK_EVENTS.forEach((e) => window.addEventListener'))
    expect(kick).toMatch(/if \(!running\) drawStill\(\)/)
  })
})
