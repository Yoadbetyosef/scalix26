// ── The AI employee's identity (single source of truth) ─────────────────────────
// The face of an AI employee is THE ROBOT — one face, everywhere in the product:
// the dashboard hero, the inbox rows, Ask Amy, and the employee list. It is drawn
// by components/brand/robot-avatar from the persona's own still.
//
// It used to be the official headshot of the chosen TTS voice, and `voiceAvatar`
// lived here to look one up. That is gone: a voice is a setting, so the employee's
// face changed whenever the dropdown did, and a human portrait beside the robot on
// the next screen made one employee read as two beings. The voice PICKER still
// shows those headshots — see lib/voices.ts — because there you are choosing whose
// voice to use, and that is a different question from who the employee is.

export type EmployeeStatus = 'on_duty' | 'busy' | 'attention' | 'paused'

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
