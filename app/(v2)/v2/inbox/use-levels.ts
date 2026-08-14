'use client'

import { useEffect, useRef, type RefObject } from 'react'

// THE METER MUST BE MEASURING WHOEVER IS MAKING THE SOUND.
//
// The canvas takes a level and renders it, and deliberately owns no microphone — "the component
// cannot and must not tell a microphone from a synthesiser". That is the right split, and it means
// somebody has to actually measure something. Nobody did: with no level() call the canvas falls back
// to a synthetic envelope, so the waveform moved to a rhythm belonging to neither person in the
// conversation, including while nobody was speaking at all.
//
// Two real sources, one at a time:
//
//   listening  the microphone, through its own analyser — YOUR voice
//   speaking   the <audio> element the reply is playing through — HIS voice
//
// Both are read from the same AudioContext and pushed to the same level() the canvas already has.

type Level = (v: number) => void

interface Args {
  /** Where the level goes. Null while the canvas is not mounted. */
  send: RefObject<Level | null>
  /** The element the reply plays through, from useTestAi. */
  audio: RefObject<HTMLAudioElement | null>
  callActive: boolean
  listening: boolean
  speaking: boolean
}

/** RMS of a frame, scaled so an ordinary speaking voice uses most of the meter. */
function rms(bytes: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < bytes.length; i++) {
    const v = (bytes[i] - 128) / 128
    sum += v * v
  }
  return Math.min(1, Math.sqrt(sum / bytes.length) * 3.2)
}

export function useVoiceLevels({ send, audio, callActive, listening, speaking }: Args) {
  const ctxRef = useRef<AudioContext | null>(null)

  /**
   * An AudioContext created outside a user gesture starts SUSPENDED, and a suspended context's
   * analyser reads flat silence — which is exactly what a meter showing nothing looks like. This one
   * was built inside the getUserMedia callback, after an await, so the gesture was long over.
   *
   * Created and resumed together, every time, because resume() is also what recovers a context the
   * browser suspended on its own when the tab lost focus.
   */
  const context = async (): Promise<AudioContext> => {
    const ctx = (ctxRef.current ??= new AudioContext())
    if (ctx.state === 'suspended') { try { await ctx.resume() } catch { /* stays silent */ } }
    return ctx
  }
  const micRef = useRef<{ stream: MediaStream; analyser: AnalyserNode } | null>(null)
  const spkRef = useRef<AnalyserNode | null>(null)
  // A MediaElementSource can be created ONCE per element, and useTestAi makes a new Audio() per
  // utterance. Remembering which elements are already wired keeps the second utterance from throwing.
  const wired = useRef(new WeakMap<HTMLAudioElement, AnalyserNode>())
  const rafRef = useRef<number | null>(null)

  // ── The microphone, for as long as the conversation lasts ─────────────────────────────────────────
  useEffect(() => {
    if (!callActive) return
    let stopped = false
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return }
        const ctx = await context()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        ctx.createMediaStreamSource(stream).connect(analyser)
        micRef.current = { stream, analyser }
        // One line, once per call: whether the meter is measuring anything. A silent meter and an
        // absent meter look identical on screen, and this is the difference between them.
        console.info(`[v2 levels] microphone open, context ${ctx.state}`)
      } catch (err) {
        console.warn('[v2 levels] no microphone —', err instanceof Error ? err.message : err)
        // Denied or unavailable. The canvas falls back to its own envelope, which is honest: it
        // labels itself DEMO precisely so movement is never mistaken for something being heard.
      }
    }
    start()
    return () => {
      stopped = true
      micRef.current?.stream.getTracks().forEach((t) => t.stop())
      micRef.current = null
    }
  }, [callActive])

  // ── The reply, whenever a new element starts playing ──────────────────────────────────────────────
  useEffect(() => {
    const el = audio.current
    if (!speaking || !el) { spkRef.current = null; return }
    try {
      const ctx = ctxRef.current ?? new AudioContext()
      ctxRef.current = ctx
      if (ctx.state === 'suspended') void ctx.resume()
      let analyser = wired.current.get(el)
      if (!analyser) {
        analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        const src = ctx.createMediaElementSource(el)
        src.connect(analyser)
        // Still has to reach the speakers: an analyser is a tap, not a destination.
        src.connect(ctx.destination)
        wired.current.set(el, analyser)
      }
      spkRef.current = analyser
    } catch {
      spkRef.current = null
    }
  }, [speaking, audio])

  // ── One loop, reading whichever source is currently the one making sound ──────────────────────────
  useEffect(() => {
    if (!callActive) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      return
    }
    const buf = new Uint8Array(256)
    const tick = () => {
      const analyser = speaking ? spkRef.current : listening ? micRef.current?.analyser ?? null : null
      if (analyser) {
        analyser.getByteTimeDomainData(buf)
        send.current?.(rms(buf))
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [callActive, listening, speaking, send])

  useEffect(() => () => { void ctxRef.current?.close() }, [])

  /**
   * Call this from the click that starts the conversation.
   *
   * The reliable way to get a running AudioContext in Chrome is to create it INSIDE the gesture. The
   * effects above run after the click has been handled and after an await, which is exactly the case
   * the autoplay policy suspends — so the meter came up silent even with the microphone open.
   */
  return { prime: () => { void context() } }
}
