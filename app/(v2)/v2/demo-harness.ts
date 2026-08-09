// A throwaway driver so the preview is clickable. NOT part of the component.
//
// ── WHY THIS IS A SEPARATE FILE, AND DELETABLE IN ONE LINE ──────────────────────────────────────────
//
// Turn-taking, voice activity detection, thresholds, barge-in and silence timing are NOT front-end
// concerns — that logic lives in the Deepgram Voice Agent. RudiCanvas is a pure renderer of state it
// is TOLD about, and it must contain no opinion about whose turn it is.
//
// So this file exists only to press the buttons the voice agent will press later. It imports the
// handle and calls the same five methods the agent will call. Nothing imports it except the shell,
// RudiCanvas does not know it exists, and deleting it removes the demo without touching the component.
//
// When the real agent is wired: delete this file and call the same methods from the socket's events.

import type { RudiHandle } from './rudi-canvas'

/** Roughly how long a spoken sentence lasts, so the preview's rhythm resembles a real one. */
const REPLY_MS = [2600, 4200, 6800]

export interface DemoSession { stop: () => void }

/**
 * One press → listening → she replies → armed. The same sequence the voice agent produces, faked.
 *
 * `level` is pushed as a synthetic envelope because there is no microphone here — the component
 * simply renders whatever number it is handed, which is the entire point of the API.
 */
export function runDemo(rudi: RudiHandle, opts: {
  replyText: () => string
  onReply: (text: string) => void
  listenMs?: number
  armedMs?: number
}): DemoSession {
  const timers: ReturnType<typeof setTimeout>[] = []
  let raf = 0
  let stopped = false
  const at = (ms: number, fn: () => void) => timers.push(setTimeout(() => { if (!stopped) fn() }, ms))

  // A synthetic level, only while listening. The component cannot tell this from a real microphone,
  // and should not be able to — it renders the number, it does not judge it.
  const t0 = performance.now()
  const pump = () => {
    if (stopped) return
    if (rudi.state() === 'listening') {
      const t = performance.now() - t0
      rudi.level(0.22 + 0.6 * Math.abs(Math.sin(t / 260)) * (0.5 + 0.5 * Math.abs(Math.sin(t / 91))))
    }
    raf = requestAnimationFrame(pump)
  }

  rudi.listen()
  raf = requestAnimationFrame(pump)

  at(opts.listenMs ?? 2500, () => {
    const text = opts.replyText()
    const ms = REPLY_MS[Math.floor(Math.random() * REPLY_MS.length)]
    opts.onReply(text)
    rudi.level(0)
    rudi.speak(text, ms)
    // The agent will call arm() from its own "assistant finished" event. Here it is a timer, and the
    // timer is the ONLY thing this file knows how to do that the agent will do properly.
    at(ms, () => rudi.arm())
    at(ms + (opts.armedMs ?? 12_000), () => rudi.endSession())
  })

  return {
    stop() {
      stopped = true
      cancelAnimationFrame(raf)
      for (const t of timers) clearTimeout(t)
    },
  }
}
