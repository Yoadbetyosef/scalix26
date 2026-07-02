// ── Business Brain — real-time avatar provider abstraction ─────────────────────────
// The UI (LiveCoo) never talks to a specific vendor. It talks to this interface only.
//
// Two kinds of provider implement it identically:
//   • PlaceholderAvatarProvider — animates the already-loaded COO portrait entirely on the
//     client (breathing, blinking, head motion, audio-reactive glow + waveform). Zero render
//     delay, zero per-briefing cost. Audio is the only streamed asset.
//   • A live provider (HeyGen Live Avatar, Tavus CVI, …) — attaches a WebRTC video stream to
//     the same container and drives it via the vendor SDK.
//
// Both share the same lifecycle, so connecting a real provider means writing ONE file that
// implements BusinessBrainAvatarProvider and pointing the factory at it. The UI does not change.

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking'

export interface BriefingSegment { text: string; section: string }

export interface SpeakOptions {
  /** Ordered briefing segments — `text` is the spoken caption, `section` drives which Business
   *  Brain card illuminates. */
  segments: BriefingSegment[]
  /** Pre-generated, cached TTS audio (data URL / https URL) — the placeholder plays and
   *  analyses this. Providers that synthesize their own speech (HeyGen/Tavus) may ignore it
   *  and speak the segment text instead. */
  audioUrl: string | null
  /** Fired when the active segment changes (0-based). Drives the illuminated card + caption. */
  onSegment: (index: number) => void
  /** Fired once the whole briefing finishes. */
  onEnd: () => void
  /** Fired if the browser blocked autoplay — the UI shows a "tap to begin" affordance that
   *  calls SpeakHandle.resume() from a fresh user gesture. */
  onBlocked?: () => void
}

export interface SpeakHandle {
  pause(): void
  resume(): void
  stop(): void
}

export interface AvatarSession {
  /** Switch the visible animation state. */
  setState(state: AvatarState): void
  /** Begin speaking a briefing. Returns transport controls. */
  speak(opts: SpeakOptions): SpeakHandle
  /** Instantaneous audio level 0..1 — lets the surrounding UI add subtle reactive touches. */
  getLevel(): number
  /** Tear down animation loops, the audio graph, and any streaming session. */
  destroy(): void
}

export interface AvatarConnectOptions {
  /** The always-loaded COO portrait — the placeholder's face, and the poster a live provider
   *  shows while its stream warms up. */
  portraitUrl: string
}

export interface BusinessBrainAvatarProvider {
  readonly id: string
  readonly displayName: string
  /** true → streams live video (HeyGen/Tavus). false → client-side animated portrait. */
  readonly isLive: boolean
  /** Render the avatar into `container`. The placeholder resolves synchronously (no delay);
   *  a live provider resolves once its WebRTC track is attached. Call this on mount so the
   *  avatar is ready before the user ever presses play. */
  connect(container: HTMLElement, opts: AvatarConnectOptions): Promise<AvatarSession>
}
