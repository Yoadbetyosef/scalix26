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
        const ctx = (ctxRef.current ??= new AudioContext())
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        ctx.createMediaStreamSource(stream).connect(analyser)
        micRef.current = { stream, analyser }
      } catch {
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
      const ctx = (ctxRef.current ??= new AudioContext())
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
      if (ctx.state === 'suspended') void ctx.resume()
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
}
