import type { RudiSegment } from '../rudi-line'

export interface OrdersLineInput {
  waiting: number
  making: number
  /** The order that has waited longest for someone to act. */
  oldestWaiting: { primary: string; trailing?: string | null } | null
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// The accent is the piece that has waited longest, because that is the one going cold.
export function ordersLine({ waiting, making, oldestWaiting }: OrdersLineInput): RudiSegment[] {
  const segments: RudiSegment[] = []
  const parts: string[] = []
  if (waiting > 0) parts.push(`${waiting} waiting on a decision`)
  if (making > 0) parts.push(`${making} in production`)
  if (parts.length) segments.push({ text: `${parts.join(', ')}. ` })

  if (!oldestWaiting) {
    segments.push({ text: waiting + making === 0 ? 'No open orders.' : 'Nothing is waiting on you.', accent: true })
    return segments
  }
  segments.push({
    text: `${oldestWaiting.primary} has waited longest${oldestWaiting.trailing ? ` — ${oldestWaiting.trailing}` : ''}.`,
    accent: true,
  })
  if (!parts.length) segments.unshift({ text: `${waiting} ${plural(waiting, 'order', 'orders')}. ` })
  return segments
}
