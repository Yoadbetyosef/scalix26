'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// TAKE OVER, THEN REPLY — the first thing in /v2 that writes.
//
// ── THE ORDER IS NOT A PREFERENCE ───────────────────────────────────────────────────────────────────
//
// /api/conversations/[id]/send refuses with 400 unless `human_takeover` is already true. So the
// button posts the takeover, waits for it, and only then becomes a composer. The same two endpoints
// in the same order the v1 screen uses; nothing here is a new path, and neither route changed.
//
// ── ok: true DOES NOT MEAN DELIVERED ────────────────────────────────────────────────────────────────
//
// The send route answers `{ ok, delivered, note }`, and there are FIVE ways to get `ok: true` with
// `delivered: false` — a paused partner, no phone on file, a mailbox needing reconnect, an
// unsupported channel, a provider that threw. Each returns the real reason in `note`.
//
// A screen that read the status code would tell the owner their message went out when it did not.
// That is the Send-to-Production bug exactly. So `delivered` decides what this says, the message
// stays in the thread either way — the route always records it — and `note` is shown verbatim,
// because it is already written in the owner's words.

interface Props {
  conversationId: string
  agentName: string
  /** Already handed over: the composer is the resting state, not the button. */
  takenOver: boolean
}

export function TakeOver({ conversationId, agentName, takenOver }: Props) {
  const router = useRouter()
  const [live, setLive] = useState(takenOver)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  /** What the last attempt actually did. Null while nothing has been claimed about it. */
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  async function takeOver() {
    setBusy(true)
    setOutcome(null)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/takeover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setOutcome({ ok: false, message: j.error || 'Could not take this conversation over.' })
        return
      }
      setLive(true)
      // The rest of the screen reads `human_takeover`, so it has to re-read.
      router.refresh()
      // The field does not exist until this render commits.
      requestAnimationFrame(() => input.current?.focus())
    } catch {
      setOutcome({ ok: false, message: 'Could not take this conversation over — check your connection.' })
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    const content = text.trim()
    if (!content || busy) return
    setBusy(true)
    setOutcome(null)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const j = await res.json().catch(() => ({}))

      if (!res.ok) {
        setOutcome({ ok: false, message: j.error || 'That did not send.' })
        return
      }

      // THE HALF THAT MATTERS. 200 only means the route ran.
      setText('')
      setOutcome(
        j.delivered
          ? { ok: true, message: 'Sent.' }
          // It IS in the thread — the route always records it — and it did not reach them. The
          // reason is already a sentence, so it is shown as one.
          : { ok: false, message: j.note || 'Saved to the thread, but not delivered.' },
      )
      router.refresh()
    } catch {
      setOutcome({ ok: false, message: 'That did not send — check your connection.' })
    } finally {
      setBusy(false)
    }
  }

  // ONE STRUCTURE, TWO STATES. The reference switches on `data-live` rather than swapping trees, and
  // that is what makes the swap happen IN PLACE: the slot is the same 64px row before and after, so
  // nothing above it moves at the moment you act. Rendering two different trees would reflow.
  return (
    <div className="v2-cmp" data-live={live || undefined}>
      <div className="v2-wrap">
        <div className="v2-slotin">
          {/* THE SAME SENTENCE, IN TWO LENGTHS. A desktop row has space to say what taking over
              costs before the reader reaches the control; 390px does not, so a phone puts the short
              line under the button. Both are in the DOM and CSS shows one — a second component would
              be two places to change the wording and two `live` states to keep in step.

              "they'll", not the reference's "she'll": the control belongs to whichever employee is
              on the thread, and the reference was written for one of them. */}
          <p className="v2-slotmsg" data-bad={outcome && !outcome.ok ? true : undefined}>
            {outcome
              ? outcome.message
              : <><b>{agentName} is handling this thread.</b> Take over and they&apos;ll stop replying.</>}
          </p>

          <button type="button" className="v2-takeover" data-touch disabled={busy} onClick={takeOver}>
            {busy ? 'Taking over…' : 'Take over and reply'}
          </button>

          <div className="v2-live">
            <input
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send() } }}
              placeholder="Reply to this conversation…"
              aria-label="Your reply"
              disabled={busy}
            />
            <button
              type="button"
              className="v2-snd"
              onClick={() => void send()}
              disabled={busy || !text.trim()}
              aria-label="Send"
            >↑</button>
          </div>
        </div>
      </div>

      {/* The phone's line: the standing explanation, or the outcome of the last attempt. A failure
          stays until the next attempt rather than fading — a message that did not arrive is not a
          transient event. */}
      <p className="v2-tosub" data-bad={outcome && !outcome.ok ? true : undefined}>
        {outcome ? outcome.message : `${agentName} stops answering this thread.`}
      </p>
    </div>
  )
}
