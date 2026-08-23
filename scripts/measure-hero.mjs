#!/usr/bin/env node
// Render the /v2 hero off the dev server and measure it — geometry, per-line contrast, card extents.
//
// Everything here exists because the hand-built fixture this replaces produced wrong numbers twice in
// one pass and both were reported as fact. It had a debug overlay painted across the frame; later a
// `sed` cut its closing </script> and the readout cards silently stopped drawing. Neither looked like
// a failure — each looked like a slightly different number.
//
// So: the page comes from committed source (app/(v2)/v2/render-probe — the real HomeClient, the real
// stylesheet, served by `next dev`), it is fetched fresh every run, and NOTHING is measured until the
// render passes its sanity checks. A page that fails one exits non-zero instead of returning a figure.
//
//   node scripts/measure-hero.mjs --port 3111 [--state idle|listening] [--out DIR] [--json]

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SHELL = join(homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1169/chrome-mac/headless_shell')
const VIEWPORT = { w: 390, h: 844 }
const DPR = 2

// The readouts fade in and out on a 5.25s cycle and their alpha is multiplied by the scan's, so the
// phase at any single capture is arbitrary. Capture across the cycle and keep the busiest frame:
// geometry has to be read at full opacity or the card's edges are lost in the fade.
const PHASES = [1200, 2100, 3000, 3900, 4800, 5700, 6600, 7500]

export class ProbeUnsound extends Error {}

/** What a correctly rendered hero must look like before any measurement is worth taking. */
export const SANITY = {
  minCardPixels: 8000,
  minCaptionLines: 3,
  maxStrayNodes: 0,
}

// Acid is rgb(217,242,36) but it is composited at whatever alpha the fade is at, over a grey
// background. A fixed rgb threshold reads a half-faded card as absent — which it did, and which is
// how "the cards did not draw" was concluded about a frame that had them at alpha 49/255. Green
// separation from blue survives compositing over grey; absolute brightness does not.
const isAcid = (r, g, b) => g - b > 18 && g >= r - 6

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

function shot(url, file, budget) {
  execFileSync(SHELL, [
    '--headless', '--disable-gpu', '--hide-scrollbars',
    `--force-device-scale-factor=${DPR}`,
    `--window-size=${VIEWPORT.w},${VIEWPORT.h}`,
    `--virtual-time-budget=${budget}`,
    `--screenshot=${file}`, url,
  ], { stdio: 'ignore' })
}

function domReport(url) {
  const out = execFileSync(SHELL, [
    '--headless', '--disable-gpu',
    `--window-size=${VIEWPORT.w},${VIEWPORT.h}`,
    '--virtual-time-budget=9000', '--dump-dom', url,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  const m = out.match(/<script id="probe-report" type="application\/json">([\s\S]*?)<\/script>/)
  if (!m) throw new ProbeUnsound('the probe wrote no report — the page never reached its ready state')
  return JSON.parse(m[1])
}

const rel = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
const contrastWithWhite = (luma) => 1.05 / (rel(luma) + 0.05)

async function pixels(file) {
  const sharp = (await import('sharp')).default
  const grey = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true })
  const rgb = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { grey: grey.data, rgb: rgb.data, w: grey.info.width, h: grey.info.height }
}

const countAcid = (px) => {
  let n = 0
  for (let i = 0; i < px.rgb.length; i += 3) if (isAcid(px.rgb[i], px.rgb[i + 1], px.rgb[i + 2])) n++
  return n
}

/** Bounding boxes of the readout cards, in CSS pixels, by connected region. */
function cardBoxes(px) {
  const { rgb, w, h } = px
  const seen = new Uint8Array(w * h)
  const boxes = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (seen[i]) continue
      const p = i * 3
      if (!isAcid(rgb[p], rgb[p + 1], rgb[p + 2])) continue
      let x0 = x, x1 = x, y0 = y, y1 = y, n = 0
      const stack = [i]
      seen[i] = 1
      while (stack.length) {
        const j = stack.pop(); n++
        const jx = j % w, jy = (j / w) | 0
        if (jx < x0) x0 = jx
        if (jx > x1) x1 = jx
        if (jy < y0) y0 = jy
        if (jy > y1) y1 = jy
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = jx + dx, ny = jy + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const k = ny * w + nx
          if (seen[k]) continue
          const q = k * 3
          if (!isAcid(rgb[q], rgb[q + 1], rgb[q + 2])) continue
          seen[k] = 1
          stack.push(k)
        }
      }
      if (n > 500) {
        boxes.push({
          pixels: n,
          left: +(x0 / DPR).toFixed(1), right: +(x1 / DPR).toFixed(1),
          top: +(y0 / DPR).toFixed(1), bottom: +(y1 / DPR).toFixed(1),
          width: +((x1 - x0) / DPR).toFixed(1), height: +((y1 - y0) / DPR).toFixed(1),
          clippedLeft: x0 <= 0, clippedRight: x1 >= w - 1, clippedTop: y0 <= 0, clippedBottom: y1 >= h - 1,
        })
      }
    }
  }
  return boxes.sort((a, b) => a.left - b.left)
}

/**
 * The lowest row still carrying robot, as opposed to backdrop.
 *
 * The backdrop is a smooth vertical gradient, so within any row it is near-uniform; the robot and its
 * contact shadow are structure. Counting pixels that fall well below their own row's median finds the
 * base without needing to know how dark the scrim has made that part of the frame.
 */
function robotBase(px, fromY = 120, toY = 640) {
  const { grey, w } = px
  let last = null
  const rowVals = new Array(w)
  for (let cy = fromY; cy <= toY; cy++) {
    const y = Math.round(cy * DPR)
    for (let x = 0; x < w; x++) rowVals[x] = grey[y * w + x]
    const sorted = Float64Array.from(rowVals).sort()
    const median = sorted[sorted.length >> 1]
    let dark = 0
    for (let x = 0; x < w; x++) if (rowVals[x] < median - 26) dark++
    if (dark > 24) last = { y: cy, darkPixels: dark, median: Math.round(median) }
  }
  return last
}

/** Per-caption-line contrast, sampled inside the line boxes the BROWSER reported. */
function lineContrast(px, lines) {
  return lines.map((ln) => {
    const vals = []
    // Sample only where this row actually has glyphs. Sampling the full column made "you." — a row a
    // quarter of the width — report three quarters bare backdrop as the ground behind its text.
    const x0 = Math.max(0, Math.round((ln.left - 2) * DPR))
    const x1 = Math.min(px.w, Math.round((ln.right + 2) * DPR))
    for (let y = Math.round(ln.top * DPR); y < Math.round(ln.bottom * DPR); y++) {
      for (let x = x0; x < x1; x++) {
        const v = px.grey[y * px.w + x]
        if (v < 235) vals.push(v)      // drop the glyphs; what remains is the ground behind them
      }
    }
    vals.sort((a, b) => a - b)
    const p90 = vals[Math.floor(vals.length * 0.9)]
    return {
      text: ln.text.slice(0, 30), accent: ln.accent, top: ln.top, bottom: ln.bottom, left: ln.left, right: ln.right,
      groundP90: p90, contrast: +contrastWithWhite(p90).toFixed(2),
    }
  })
}

/** A vertical strip of mean luma, for looking at a gradient edge. */
export function lumaStrip(px, fromY, toY, x0 = 0, x1 = VIEWPORT.w) {
  const rows = []
  for (let cy = fromY; cy <= toY; cy++) {
    const y = Math.round(cy * DPR)
    let sum = 0, n = 0
    for (let x = Math.round(x0 * DPR); x < Math.round(x1 * DPR); x++) { sum += px.grey[y * px.w + x]; n++ }
    rows.push({ y: cy, luma: +(sum / n).toFixed(2) })
  }
  return rows
}

export async function measure({ port, state, outDir, ...opts }) {
  mkdirSync(outDir, { recursive: true })
  // --url lets the same instrument measure any page that mounts ProbeReport, which is how /v2 and
  // /dashboard get compared by one tool instead of by two descriptions.
  const url = opts.url
    ? `http://localhost:${port}${opts.url}${state === 'listening' ? (opts.url.includes('?') ? '&' : '?') + 'state=listening' : ''}`
    : `http://localhost:${port}/v2/render-probe${state === 'listening' ? '?state=listening' : ''}`
  const report = domReport(url)

  // Capture across the fade cycle and keep the frame with the most card coverage.
  let best = null
  for (const budget of PHASES) {
    const file = join(outDir, `hero-${state}-${budget}.png`)
    rmSync(file, { force: true })          // never measure a stale frame
    shot(url, file, budget)
    const px = await pixels(file)
    const acid = countAcid(px)
    if (!best || acid > best.acid) best = { file, px, acid, budget }
  }

  const png = join(outDir, `hero-${state}.png`)
  rmSync(png, { force: true })
  execFileSync('/bin/cp', [best.file, png])
  const { px } = best

  // ── sanity, before a single number is believed ────────────────────────────────────────────────
  const problems = []
  if (report.state !== state) problems.push(`root data-state is "${report.state}", expected "${state}"`)
  if (report.strayNodes.length > SANITY.maxStrayNodes) problems.push(`painted over the frame: ${report.strayNodes.join('; ')}`)
  const lineCount = report.captionLines?.length ?? 0
  if (lineCount < SANITY.minCaptionLines) problems.push(`caption laid out ${lineCount} lines, expected ${SANITY.minCaptionLines} — the sample bands would not be comparable`)
  if (px.w !== VIEWPORT.w * DPR || px.h !== VIEWPORT.h * DPR) problems.push(`frame is ${px.w}x${px.h}, expected ${VIEWPORT.w * DPR}x${VIEWPORT.h * DPR}`)
  if (best.acid < SANITY.minCardPixels) problems.push(`peak card coverage was ${best.acid}px across ${PHASES.length} phases — the readouts never drew`)
  if (problems.length) throw new ProbeUnsound(problems.map((p) => `  · ${p}`).join('\n'))

  const cards = cardBoxes(px)
  const clipped = cards.filter((c) => c.clippedLeft || c.clippedRight || c.clippedTop || c.clippedBottom)
  const lines = lineContrast(px, report.captionLines)
  const ratios = lines.map((l) => l.contrast)

  return {
    state, png, budget: best.budget, report, cards, clipped, acid: best.acid, lines,
    // Stop above the scrim: below it the veil is the darkest thing in the frame and the caption's own
    // backdrop reads as structure, so the detector would report the copy as part of the robot.
    base: robotBase(px, 120, Math.max(140, report.scrim.top - 4)),
    floor: Math.min(...ratios),
    spread: +Math.abs(ratios[0] - ratios[ratios.length - 1]).toFixed(2),
    px,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = arg('port', '3111')
  const outDir = arg('out', join(process.cwd(), '.probe'))
  const states = arg('state') ? [arg('state')] : ['idle', 'listening']
  const results = []
  for (const state of states) {
    try {
      const r = await measure({ port, state, outDir, url: arg('url') })
      results.push(r)
      if (!flag('json')) {
        console.log(`\n── ${state.toUpperCase()}   ${r.png}   (peak phase ${r.budget}ms, ${r.acid} card px)`)
        console.log(`   scrim    top ${r.report.scrim.top}  height ${r.report.scrim.height}  ${r.report.scrimPct}% of hero`)
        console.log(`   caption  top ${r.report.caption.top}  bottom ${r.report.caption.bottom}  ${r.report.captionLines.length} lines`)
        for (const l of r.lines) {
          console.log(`     ${(l.accent ? '~' : ' ')}"${l.text}"`.padEnd(38) + `y ${l.top}-${l.bottom}  ground ${String(l.groundP90).padStart(3)}  ${l.contrast.toFixed(2)}:1`)
        }
        console.log(`   floor ${r.floor.toFixed(2)}:1${r.floor >= 4.5 ? ' ok' : ' UNDER'}    spread ${r.spread.toFixed(2)}${r.spread < 0.5 ? ' ok' : ' OVER'}   (~ = accent-coloured, not white)`)
        for (const c of r.cards) {
          const clip = [c.clippedLeft && 'left', c.clippedRight && 'right', c.clippedTop && 'top', c.clippedBottom && 'bottom'].filter(Boolean)
          console.log(`   card     x ${c.left}-${c.right}  y ${c.top}-${c.bottom}  ${c.width}x${c.height}  ${c.pixels}px${clip.length ? '  CLIPPED ' + clip.join('+') : ''}`)
        }
        if (r.base) console.log(`   robot base  y ${r.base.y}  (${r.base.darkPixels} px below row median)`)
        console.log(`   button   "${r.report.talk.label}"  data-on=${r.report.talk.on}`)
      }
    } catch (e) {
      console.error(`\nx ${state}: the render is not sound, so nothing was measured.\n${e.message}`)
      process.exitCode = 1
    }
  }
  if (flag('json')) console.log(JSON.stringify(results.map(({ px, ...r }) => r), null, 2))
}
