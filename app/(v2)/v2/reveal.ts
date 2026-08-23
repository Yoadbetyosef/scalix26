// ── THE TRANSCRIPT ARRIVES ALL AT ONCE, AND IS REVEALED A WORD AT A TIME ───────────────────────────
//
// The agent sends no partial recognition. One ConversationText lands about 700ms after the endpoint
// carrying the whole sentence, so there is nothing to stream and a second socket would not change
// that. What there IS is a beat between somebody stopping talking and their words appearing, and a
// sentence that materialises in one frame after that beat reads as a screenshot rather than as
// something being heard.
//
// So the reveal is presentation, and it lives here rather than in amy-realtime: that layer reports
// what the socket said and should not also own how long a screen takes to say it.
//
// ── AND IT LIVES IN ITS OWN FILE SO IT CAN BE RUN ───────────────────────────────────────────────────
//
// It used to be three refs and a closure inside HomeClient, which meant the only way to execute it
// was to hold a real voice call. `revealStepMs` had a test because it is arithmetic; the sequencing —
// the words stepping, and her turn being HELD until the last one — had only source-text assertions
// greping the component for the shape of a line. Those pass whether or not the code works.
//
// Pulled out, it is a plain object with no React in it, so a test with fake timers can drive a whole
// turn. See reveal.test.ts for what that does and does not prove.

const REVEAL_WORD_MS = 45
/** A twenty-word sentence would hold the turn for nearly a second at 45ms. The cap is what stops the
 *  length of what somebody said deciding how long they wait to see it. */
const REVEAL_CAP_MS = 700

/**
 * How long one word waits, for a sentence of this many.
 *
 * Pure and exported so the cap is a fact with a test rather than an expression buried in an interval:
 * 45ms each until a sentence is long enough that 45ms each would break the ceiling, and from there
 * the whole reveal takes REVEAL_CAP_MS however many words there are.
 */
export const revealStepMs = (words: number): number =>
  Math.min(REVEAL_WORD_MS, REVEAL_CAP_MS / Math.max(1, words))

export interface RevealHost {
  /** Show this much of the sentence. The caller renders it; this decides when. */
  show(text: string): void
  /** Her turn begins. Called at most once per sentence, and never before the last word. */
  arm(): void
  /** Whether the viewer has asked for less motion. Read per sentence, not captured once. */
  reduced(): boolean
}

export interface Reveal {
  /** A transcript landed. Starts the reveal, replacing any still running. */
  say(text: string): void
  /**
   * Her turn. HELD, NOT DELAYED — the socket's emit guard drops an arm that arrives while she is
   * still audible and a dropped arm never re-fires, so the moment is taken on the tick it was sent
   * and only the CALL waits for the last word.
   */
  arm(): void
  /** Stop a reveal in flight and show the whole sentence. Any pending turn is dropped. */
  settle(): void
  /** Whether a sentence is still landing. */
  readonly running: boolean
}

export function createReveal(host: RevealHost): Reveal {
  let timer: ReturnType<typeof setInterval> | null = null
  let full: string | null = null
  let pendingArm = false

  const stop = () => {
    if (timer) { clearInterval(timer); timer = null }
  }

  const settle = () => {
    stop()
    // A pending arm is a promise about whose turn it is. By the time anything settles a reveal — she
    // answered, the caller started again, the session closed, the component went away — it is no
    // longer true, so it is dropped rather than fired.
    pendingArm = false
    if (full !== null) { host.show(full); full = null }
  }

  return {
    get running() { return timer !== null },

    settle,

    arm() {
      if (timer) pendingArm = true
      else host.arm()
    },

    say(text: string) {
      settle()
      const words = text.trim().split(/\s+/).filter(Boolean)
      // Nothing to reveal, or somebody has asked for less motion: the sentence at once. No arm here —
      // with no timer running, an arm that follows takes the direct branch above, which is the same
      // tick it would have fired on anyway.
      if (words.length < 2 || host.reduced()) { host.show(text); return }

      full = text
      let i = 1
      host.show(words[0])
      timer = setInterval(() => {
        i++
        host.show(words.slice(0, i).join(' '))
        if (i < words.length) return
        stop()
        full = null
        // HER TURN BEGINS WHEN THE SENTENCE FINISHES LANDING, not when the socket said so. Listening
        // outlives the endpoint by exactly the reveal, which is the reading we want — still catching
        // up — and it is why the veil stays raised and the button still says End until the last word.
        if (pendingArm) { pendingArm = false; host.arm() }
      }, revealStepMs(words.length))
    },
  }
}
