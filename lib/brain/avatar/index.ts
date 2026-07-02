import type { AvatarConnectOptions, AvatarSession, BusinessBrainAvatarProvider } from './types'
import { PlaceholderAvatarProvider } from './placeholder'
import { RpmAvatarProvider } from './rpm'

// ── The single wiring point ─────────────────────────────────────────────────────────
// getAvatarProvider() decides which avatar the whole app uses. To connect a live real-time
// avatar (HeyGen Live Avatar, Tavus CVI, …): add `lib/brain/avatar/heygen.ts` implementing
// BusinessBrainAvatarProvider (its connect() attaches the vendor's WebRTC <video> and maps
// talking-start/stop onto onSegment/onEnd) and return it here. Nothing in the UI changes.

let cached: BusinessBrainAvatarProvider | null = null

export function getAvatarProvider(): BusinessBrainAvatarProvider {
  if (cached) return cached
  cached = new RpmAvatarProvider() // 3D avatar with client-side lip motion
  return cached
}

// Connect with a safety net: if the primary provider can't initialise (e.g. the GLB fails to
// load, or a live provider errors), fall back to the always-available animated portrait so the
// briefing never black-screens.
export async function connectAvatar(container: HTMLElement, opts: AvatarConnectOptions): Promise<AvatarSession> {
  try {
    return await getAvatarProvider().connect(container, opts)
  } catch (e) {
    console.warn('[avatar] primary provider failed — falling back to portrait', e)
    return new PlaceholderAvatarProvider().connect(container, opts)
  }
}

export type {
  BusinessBrainAvatarProvider, AvatarSession, AvatarState, SpeakHandle, SpeakOptions, BriefingSegment,
} from './types'
