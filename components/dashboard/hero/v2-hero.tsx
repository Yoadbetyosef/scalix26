'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RudiCanvas, type RudiHandle, type RudiState } from '@/app/(v2)/v2/rudi-canvas'
import { Composer } from '@/app/(v2)/v2/composer'
import { useIsMobile } from '@/app/(v2)/v2/use-breakpoint'
import { usePressState } from '@/app/(v2)/v2/use-press'
import { createReveal, type Reveal } from '@/app/(v2)/v2/reveal'
import { AmyRealtime, type AmyMoment } from './amy-realtime'
import { AskAmyText } from './ask-amy-text'
import type { AmyBriefing } from './ask-amy-shared'
import { useAmySession } from './use-amy-session'
import { usePresenceScan } from './use-presence-scan'
import { rudiLine } from '@/app/(v2)/v2/rudi-line'
import { useAttention } from '@/components/dashboard/attention'
import type { HomeView } from '@/lib/dashboard/home-view'
import type { PersonaKey } from '@/lib/persona'
import '@/app/(v2)/v2/v2-tokens.css'

// THE /v2 HERO, ON THE DASHBOARD, READING v1'S DATA.
//
// Not a robot pasted beside the old identity row — the composition itself: full-bleed portrait, the
// scan, the sentence over it, the readouts, the Talk button. What changes when it lands here is
// nothing about what it does. The sentence is the one v1 already computes, the readouts are v1's own
// counts, and the Talk button opens the session AskAmy has always opened, because /v2 was already
// calling useAmySession — v1's machine — rather than one of its own.
//
// ── WHY IT IS SAFE TO IMPORT v2's STYLESHEET INTO v1 ────────────────────────────────────────────
//
// 1,042 of its 1,198 rules begin with `.v2`, so they are inert outside the wrapper below. The rest
// are `.v2-*` classes and nothing in v1 carries one; the only selector that even starts with an
// element name is `textarea.v2-mbox:focus`, which still needs the class. So the sheet cannot reach
// v1 markup, and inside the wrapper the hero is styled by the same rules that style /v2.
//
// The wrapper takes `v2-embedded` with it. Plain `.v2` is a full screen — 100dvh, overflow hidden —
// which is right for a route that owns the viewport and wrong for a band at the top of a page that
// scrolls. See the embedded block in v2-tokens.css.

export interface V2HeroProps {
  /** Which employee to paint. From the ai_employees row — NOT assumed to be Rudi. */
  persona: PersonaKey
  employeeName: string
  /**
   * The caption's INPUTS, not a built sentence.
   *
   * Inputs because the count of things needing a person is live: v1's AttentionSentence subscribed to
   * the attention store and updated without a reload, and building the sentence on the server would
   * have thrown that away to match /v2. The other three counts are server facts; only `waiting` moves,
   * so only `waiting` is replaced below.
   */
  line: HomeView['line']
  /** Three pairs, cycled over the picture. v1's counts — see the note on RudiCanvas.cards. */
  readouts: Array<Array<[string, string]>>
  /** What the agent is told about the business. v1 builds this already, in buildHeroInputs. */
  briefing: AmyBriefing
  /** Desktop only: what goes in /v2's right-hand column. v1's figures, in /v2's place for them. */
  aside?: React.ReactNode
}

export function V2Hero({ persona, employeeName, line, readouts, briefing, aside }: V2HeroProps) {
  const rudi = useRef<RudiHandle | null>(null)
  const [state, setState] = useState<RudiState>('idle')
  const [said, setSaid] = useState<string | null>(null)
  const [typing, setTyping] = useState(false)
  const isMobile = useIsMobile()
  const amy = useAmySession()
  usePressState()
  usePresenceScan(rudi)

  // The reveal, as /v2 does it: the transcript lands whole and is shown a word at a time, and her
  // turn is held until the last one. Same sequencer, no React in it — see reveal.ts.
  //
  // BUILT IN AN EFFECT, not during render. /v2's home-client fills a ref in the render body and
  // eslint's react-hooks/refs flags it — that is the "1 Issue" badge on the dev overlay. Neither a
  // lazy useState initialiser nor a useCallback satisfies the rule, and it is right not to: this
  // thing owns interval timers, so constructing it is a side effect and an effect is where side
  // effects go. Everything that drives it runs after mount anyway — the session mounts later still.
  const revealRef = useRef<Reveal | null>(null)
  useEffect(() => {
    const r = createReveal({
      show: (text) => setSaid(text),
      arm: () => rudi.current?.arm(),
      reduced: () => typeof window !== 'undefined'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    })
    revealRef.current = r
    return () => r.settle()
  }, [])

  const onMoment = useCallback((m: AmyMoment) => {
    const r = rudi.current
    const reveal = revealRef.current
    if (!r || !reveal) return
    if (m.type === 'listen') { reveal.settle(); r.listen() }
    else if (m.type === 'level') r.level(m.value)
    else if (m.type === 'speak') { reveal.settle(); r.speak(m.text, m.ms) }
    else if (m.type === 'stopSpeaking') r.stopSpeaking()
    else if (m.type === 'arm') reveal.arm()
    else if (m.type === 'said') reveal.say(m.text)
  }, [])

  const toggleTalk = useCallback(() => {
    if (amy.mode !== 'idle') { amy.close(); rudi.current?.endSession(); return }
    amy.goLive()
  }, [amy])

  const onSubmit = useCallback((text: string) => {
    revealRef.current?.settle()
    setSaid(text)
    amy.goText()
  }, [amy])

  // null until measured — see use-breakpoint. Rendering nothing for one frame beats rendering the
  // wrong tree and jumping, and the canvas is keyed so crossing 720px genuinely remounts it.
  const mode = isMobile === null ? 'pending' : isMobile ? 'mobile' : 'desktop'

  // The live count, when the store has one. Same subscription AttentionSentence used, so resolving a
  // notification still changes the sentence without a reload — the thing matching /v2 would have cost.
  const attention = useAttention()
  const sentence = rudiLine({ ...line, waiting: attention.ready ? attention.unresolvedCount : line.waiting })

  return (
    <div className="v2 v2-embedded">
      <div className="v2-root" data-mode={mode} data-state={state}>
        <div className="v2-hero">
          <RudiCanvas
            key={mode}
            persona={persona}
            breakpoint={isMobile === false ? 'desktop' : 'mobile'}
            handleRef={rudi}
            onStateChange={setState}
            readouts={isMobile === true}
            cards={readouts}
            className="v2-face"
            onClick={toggleTalk}
          />
          <div className="v2-scrim" />
          {/* data-bottom-block is READ BY THE CANVAS — the readouts are placed off whatever this
              grows to, so a longer sentence pushes them up rather than being covered by them. */}
          <div className="v2-overlay" data-bottom-block>
            {/* /v2 printed "listening on <number>" here. It belonged to a screen that was only a
                phone presence; on the dashboard it was illegible white over the picture and said
                nothing the page does not say elsewhere. Dropped rather than restyled. */}
            {said && <p className="v2-you"><span className="v2-you-who">You · </span>{said}</p>}
            <p className="v2-cap">
              {sentence.map((seg, i) => (seg.accent
                ? <b key={i}>{seg.text}</b>
                : <span key={i}>{seg.text}</span>))}
            </p>
            <Composer
              name={employeeName}
              state={state}
              onTalk={toggleTalk}
              onSubmit={onSubmit}
              onTypingChange={setTyping}
            />
          </div>
        </div>
        {/* The right-hand column, on desktop, the way /v2 composes it — and holding the same thing
            /v2 holds there: the day's figures as static tiles. It is why the readouts are drawn on
            the portrait on mobile only; two animated copies of one number beside each other was
            never the design. */}
        {isMobile === false && aside && <aside className="v2-side" data-scroll>{aside}</aside>}
      </div>
      {/* The session's own UI, exactly as /v2 mounts it — AmyRealtime while live, the text sheet
          while typing, nothing at rest. This is v1's component either way; /v2 never had its own. */}
      {amy.mode === 'live' && (
        <AmyRealtime
          briefing={briefing}
          audioCtx={amy.audioCtx}
          onClose={() => { amy.close(); rudi.current?.endSession() }}
          onType={amy.goText}
          onMoment={onMoment}
          surface="v2"
        />
      )}
      {amy.mode === 'text' && <AskAmyText briefing={briefing} onTalk={amy.goLive} />}
      <span hidden aria-hidden>{typing ? 'typing' : ''}</span>
    </div>
  )
}
