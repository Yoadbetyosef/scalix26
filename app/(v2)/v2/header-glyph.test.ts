import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A HEADER BUTTON CONTAINS ITS OWN CONTENT.
//
// This asserts the OUTCOME — scrollWidth === clientWidth, "nothing is sticking out of this box" —
// rather than the flex values that happen to produce it today. The previous guard asserted
// `.v2-hacts { ... flex: none }`, which passed for weeks while the New button on /v2/invoices showed a
// plus and half an "N", because the flex value was never the mechanism.
//
// ── WHAT WAS ACTUALLY WRONG, AND WHY NO SOURCE ASSERTION WOULD HAVE CAUGHT IT ───────────────────
//
// `<svg viewBox="0 0 24 24">` with no width/height has no intrinsic width. It contributes ZERO to
// max-content sizing, so the button's box was measured as if the glyph were not in it, and the glyph
// then painted at whatever the cross axis resolved to — 32.8px wide inside a 62.8px button whose
// content wanted 80px. `flex: none` does not help: the base size it refuses to shrink from was
// already short. Nothing about that is visible in the source of either file; it only exists once a
// layout engine has run.
//
// So this test runs one. It builds a page from the REAL stylesheet and the REAL glyph component,
// measures it in headless Chrome, and checks both directions in a single load:
//
//   1. As shipped, every header button contains its content.
//   2. With the size neutralised, the fault REPRODUCES — otherwise a green result here would only
//      prove that the harness cannot detect the bug it exists to detect.
//
// Two further copies carry a title too long for the line. That covers the OTHER header fault — the one
// 750d82a fixed — in the same terms: the title is what yields, and the buttons keep their width. It
// was asserted as `flex: none` in a string match, which is the habit this file exists to break.
//
// It skips when there is no Chrome. A guard that cannot run is better than a suite that cannot.

const CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]
const chrome = CHROMES.find((p) => existsSync(p)) ?? null

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')

/** The glyph the header actually renders, taken from the component rather than retyped here. */
function plusGlyph(): string {
  const src = read('./invoices/glyphs.tsx')
  const svg = src.slice(src.indexOf('export const Plus'))
  const markup = svg.slice(svg.indexOf('<svg'), svg.indexOf('</svg>') + 6)
  // JSX → HTML. Only the attribute spellings differ.
  return markup
    .replace(/strokeWidth/g, 'stroke-width').replace(/strokeLinecap/g, 'stroke-linecap')
    .replace(/strokeLinejoin/g, 'stroke-linejoin').replace(/aria-hidden(?!=)/g, 'aria-hidden="true"')
    .replace(/\{[^}]*\}/g, '')
}

interface Box { width: number; scrollWidth: number; clientWidth: number; glyphWidth: number; titleWidth: number; actionsWidth: number; lineOverflow: number }

function measure(): Record<string, Box> {
  const css = read('./v2-tokens.css')
  const glyph = plusGlyph()
  const LONG_TITLE = 'Invoices, and every document anybody has ever sent a customer'

  // Four copies of the same header in one load. `broken` neutralises the size the rule sets — the
  // state this screen actually shipped in — so the harness proves it can still see the fault. `long`
  // and `longwide` are the same over-long title with and without room, which is the only way to tell
  // "the title yielded" from "the title happened to fit".
  const page = `<!doctype html><html><head><meta charset="utf-8"><style>
${css}
html,body{margin:0;font-family:system-ui,sans-serif}
#broken .v2-hact svg{width:auto;height:auto}
/* .v2-page is position:absolute inset:0, so without a positioned wrapper every copy resolves against
   the viewport and stacks on top of the others at the same width. Each gets its own box. */
.copy{position:relative;height:110px}
/* The narrow copy. At 1440 the column is 820px and a long title simply fits — the title only has to
   yield when the line is genuinely short of room, so the constraint has to be MADE rather than
   assumed. The longwide copy is the same title with room, to compare against. */
#long{width:360px}
</style></head><body><div class="v2">
${[['shipped', 'Invoices'], ['broken', 'Invoices'], ['long', LONG_TITLE], ['longwide', LONG_TITLE]].map(([id, title]) => `<div id="${id}" class="copy"><div class="v2-page"><header class="v2-phd" data-inner><div class="v2-phdin">
<a class="v2-bk"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></a><h2>${title}</h2>
<div class="v2-hacts">
<button class="v2-hact" data-touch>Payment details</button>
<button class="v2-hact" data-tone="primary" data-touch>${glyph}New</button>
</div></div></header></div></div>`).join('\n')}
</div><pre id="out"></pre><script>
const out={}
for(const id of ['shipped','broken','long','longwide']){
  const btn=document.querySelector('#'+id+' .v2-hact[data-tone="primary"]')
  const g=btn.querySelector('svg')
  const row=document.querySelector('#'+id+' .v2-phdin')
  const acts=document.querySelector('#'+id+' .v2-hacts')
  const h2=document.querySelector('#'+id+' h2')
  out[id]={width:btn.getBoundingClientRect().width,scrollWidth:btn.scrollWidth,clientWidth:btn.clientWidth,
           glyphWidth:g.getBoundingClientRect().width,
           titleWidth:h2.getBoundingClientRect().width,
           actionsWidth:acts.getBoundingClientRect().width,
           lineOverflow:acts.getBoundingClientRect().right-(row.getBoundingClientRect().right-parseFloat(getComputedStyle(row).paddingRight))}
}
document.getElementById('out').textContent=JSON.stringify(out)
</script></body></html>`

  const dir = mkdtempSync(join(tmpdir(), 'v2-hdr-'))
  const file = join(dir, 'header.html')
  writeFileSync(file, page)
  const dom = execFileSync(chrome as string, [
    '--headless', '--disable-gpu', '--no-sandbox', '--window-size=1440,900',
    '--virtual-time-budget=4000', '--dump-dom', `file://${file}`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000 })

  // [\s\S] rather than the /s flag: tsconfig targets below es2018, where the flag is a compile error.
  const json = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/)?.[1]
  if (!json) throw new Error('the harness produced no measurements')
  return JSON.parse(json.replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
}

describe.skipIf(!chrome)('the header button contains its own content', () => {
  const m = measure()

  it('nothing sticks out of the New button', () => {
    // The whole assertion, in the only terms that describe the symptom: the box is as wide as what
    // is in it. Not a flex value, not a pixel count that a copy change would invalidate.
    expect(m.shipped.scrollWidth).toBe(m.shipped.clientWidth)
  })

  it('and the glyph is sized by the rule, not by the element that passes it in', () => {
    // 15px, from `.v2 .v2-hact svg`. The point of sizing it there is that the NEXT header glyph
    // inherits it without its author having to know any of this.
    expect(m.shipped.glyphWidth).toBe(15)
  })

  it('a title too long for the line truncates, and the buttons keep their width', () => {
    // The fault 750d82a fixed, asserted as behaviour this time. A truncated title is still a title;
    // half a button is not a button.
    // Same title, one narrow line and one with room: the narrow one is the one that gives.
    expect(m.long.titleWidth).toBeLessThan(m.longwide.titleWidth)
    expect(m.long.actionsWidth).toBe(m.shipped.actionsWidth)
    expect(m.long.scrollWidth).toBe(m.long.clientWidth)
    // And the row itself still ends inside its own column.
    expect(m.long.lineOverflow).toBeLessThanOrEqual(0.5)
  })

  it('the fault reproduces when that size is taken away', () => {
    // Without this, a green suite would only prove the harness cannot see the bug. Measured at the
    // time of writing: a 32.8px glyph in a 62.8px button wanting 80px.
    expect(m.broken.glyphWidth).toBeGreaterThan(20)
    expect(m.broken.scrollWidth).toBeGreaterThan(m.broken.clientWidth)
  })
})
