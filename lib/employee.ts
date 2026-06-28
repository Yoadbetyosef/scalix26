// ── The AI employee's identity (single source of truth) ─────────────────────────
// The face of an AI employee is the official headshot of the voice the customer
// actually hears. Same employee → same face, everywhere in the product. No stock
// photos, no per-screen switching between an initial, an icon and a photo.

export type EmployeeStatus = 'on_duty' | 'busy' | 'attention' | 'paused'

const VOICE_AVATAR: Record<string, string> = {
  'aura-2-asteria-en': '/avatars/asteria.png',
  'aura-2-andromeda-en': '/avatars/andromeda.png',
  'aura-2-thalia-en': '/avatars/thalia.png',
  'aura-2-odysseus-en': '/avatars/odysseus.png',
  'aura-2-arcas-en': '/avatars/arcas.png',
}

/** The headshot for a voice, or null for a legacy/unknown voice (→ monogram fallback). */
export function voiceAvatar(voice?: string | null): string | null {
  return voice ? VOICE_AVATAR[voice] ?? null : null
}

/** Map the stored agent status to the employee presence system. */
export function employeeStatus(status?: string | null): EmployeeStatus {
  return status === 'active' ? 'on_duty' : 'paused'
}

export const STATUS_META: Record<EmployeeStatus, { dot: string; label: string; pulse: boolean }> = {
  on_duty: { dot: 'bg-emerald-500', label: 'On duty', pulse: true },
  busy: { dot: 'bg-amber-500', label: 'Busy', pulse: true },
  attention: { dot: 'bg-red-500', label: 'Needs attention', pulse: true },
  paused: { dot: 'bg-muted', label: 'Paused', pulse: false },
}
