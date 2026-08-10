'use client'

// Where the time actually goes, measured rather than guessed.
//
// The canvas reports 24ms to first draw, and that is real — but it measures from MOUNT, so it says
// nothing about the seconds before mount. This measures the whole span from navigation start, and it
// separates the three things that could be responsible:
//
//   the server        nav -> ttfb -> html
//   hydration         html -> shell (React attaching handlers; until this, clicks do nothing)
//   the streamed data html -> data (getImpactData and friends resolving)
//
// The one that matters most is `input`: the browser's own measurement of how long the first click sat
// in the queue before its handler could run. If that is large, the main thread was blocked, and the
// `block` figure names the worst single task responsible.
//
// Everything here is diagnostic and deletable. No dependency: PerformanceObserver and the Navigation
// Timing API are both platform.

type Mark = 'shell' | 'canvas' | 'data'

const marks = new Map<Mark, number>()
let printed = false
let worstTask = 0
let totalBlocking = 0
let inputDelay: number | null = null
let printTimer: ReturnType<typeof setTimeout> | null = null

const ms = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)}ms`)

function navTiming() {
  if (typeof performance === 'undefined') return null
  const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
  return nav ?? null
}

/** One line, printed once. */
function print(reason: string) {
  if (printed || typeof performance === 'undefined') return
  printed = true
  if (printTimer) { clearTimeout(printTimer); printTimer = null }
  const nav = navTiming()
  const shell = marks.get('shell')
  const canvas = marks.get('canvas')
  const data = marks.get('data')

  // Gaps, which are the point — a total tells you little, the span between two marks tells you which
  // stage owns the delay.
  const html = nav?.responseEnd
  const hydrationGap = shell != null && html != null ? shell - html : null

  console.info(
    `[v2 timing] ${reason} | ttfb ${ms(nav?.responseStart)} · html ${ms(html)} · shell-hydrated ${ms(shell)} `
    + `(+${ms(hydrationGap)} after html) · canvas ${ms(canvas)} · data ${ms(data)} `
    + `| first-input-delay ${ms(inputDelay)} · worst-task ${ms(worstTask)} · blocking ${ms(totalBlocking)}`,
  )
}

/** Record a milestone, in ms since navigation start. */
export function mark(name: Mark) {
  if (typeof performance === 'undefined' || marks.has(name)) return
  marks.set(name, performance.now())
}

/**
 * Start observing. Safe to call more than once.
 *
 * Prints when the first interaction lands — because that is the moment the reported symptom either
 * happens or does not — and otherwise after a delay, so a page nobody clicks still reports.
 */
export function startTiming() {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return

  try {
    // The browser's own first-input measurement: how long the click waited for the main thread.
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { processingStart?: number })[]) {
        if (inputDelay == null && e.processingStart != null) inputDelay = e.processingStart - e.startTime
      }
      print('first input')
    }).observe({ type: 'first-input', buffered: true })
  } catch { /* not supported */ }

  try {
    // What was holding the thread. A 30-60s symptom should show up here as one enormous task.
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        worstTask = Math.max(worstTask, e.duration)
        totalBlocking += Math.max(0, e.duration - 50)
      }
    }).observe({ type: 'longtask', buffered: true })
  } catch { /* not supported */ }

  if (!printTimer) printTimer = setTimeout(() => print('no interaction yet'), 12_000)
}
