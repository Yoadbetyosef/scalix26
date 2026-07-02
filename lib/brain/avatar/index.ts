import type { AvatarConnectOptions, AvatarSession, BusinessBrainAvatarProvider } from './types'
import { PlaceholderAvatarProvider } from './placeholder'

// ── The single wiring point ─────────────────────────────────────────────────────────
// getAvatarProvider() decides which avatar the whole app uses. To connect a live real-time
// avatar (HeyGen Live Avatar, Tavus CVI, …): add `lib/brain/avatar/heygen.ts` implementing
// BusinessBrainAvatarProvider (its connect() attaches the vendor's WebRTC <video> and maps
// talking-start/stop onto onSegment/onEnd) and return it here. Nothing in the UI changes.

let cached: BusinessBrainAvatarProvider | null = null

export function getAvatarProvider(): BusinessBrainAvatarProvider {
  if (!cached) cached = new PlaceholderAvatarProvider() // static portrait + breathing/glow/waveform
  return cached
}

// Connect with a safety net so the briefing never black-screens if a provider fails to init.
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
