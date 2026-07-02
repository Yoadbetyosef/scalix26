import type { BusinessBrainAvatarProvider } from './types'
import { PlaceholderAvatarProvider } from './placeholder'

// ── The single wiring point ─────────────────────────────────────────────────────────
// To connect a real-time avatar (HeyGen Live Avatar, Tavus CVI, …):
//   1. Add `lib/brain/avatar/heygen.ts` (or `tavus.ts`) exporting a class that implements
//      BusinessBrainAvatarProvider — its `connect()` attaches the vendor's WebRTC <video> to
//      the given container and maps talking-start/stop events onto onSegment/onEnd.
//   2. Return it from `getAvatarProvider()` below (optionally gated by an env flag).
// Nothing in the UI (LiveCoo) changes — it only ever sees this interface.

let cached: BusinessBrainAvatarProvider | null = null

export function getAvatarProvider(): BusinessBrainAvatarProvider {
  if (cached) return cached
  // Swap this line to a live provider once one is implemented, e.g.:
  //   cached = new HeyGenAvatarProvider()
  cached = new PlaceholderAvatarProvider()
  return cached
}

export type {
  BusinessBrainAvatarProvider, AvatarSession, AvatarState, SpeakHandle, SpeakOptions, BriefingSegment,
} from './types'
