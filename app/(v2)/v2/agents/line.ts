import type { RudiSegment } from '../rudi-line'

export interface AgentsLineInput {
  total: number
  onDuty: number
  channels: number
  /** An agent with no channel cannot be reached by anyone. */
  unreachable: number
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// The accent is the one thing an owner can act on here: an employee nobody can reach. Otherwise it
// states who is on duty, which is the resting good state and reads like one.
export function agentsLine({ total, onDuty, channels, unreachable }: AgentsLineInput): RudiSegment[] {
  if (total === 0) return [{ text: 'No AI employees yet.', accent: true }]

  const segments: RudiSegment[] = [
    { text: `${total} AI ${plural(total, 'employee', 'employees')} across ${channels} ${plural(channels, 'channel', 'channels')}. ` },
  ]
  if (unreachable > 0) {
    segments.push({
      text: `${unreachable} ${plural(unreachable, 'has', 'have')} no channel — nobody can reach ${plural(unreachable, 'it', 'them')}.`,
      accent: true,
    })
    return segments
  }
  segments.push({
    text: onDuty === total ? 'All of them are on duty.' : `${onDuty} on duty.`,
    accent: true,
  })
  return segments
}
