import type { RudiSegment } from '../../rudi-line'

export interface OrderLineInput {
  stage: string
  stageLabel: string
  items: number
  waitingOn: string | null
  /** Days until the requested completion date, negative when it has passed. Null when none is set. */
  dueInDays: number | null
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// The accent is what happens next, because that is what an owner opens an order to find out. Where
// nothing is pending it says where the piece has got to instead of manufacturing an action.
export function orderLine({ stageLabel, items, waitingOn, dueInDays }: OrderLineInput): RudiSegment[] {
  const segments: RudiSegment[] = [{ text: `${items} ${plural(items, 'piece', 'pieces')}, ${stageLabel.toLowerCase()}. ` }]

  if (waitingOn) {
    segments.push({ text: `Waiting on ${waitingOn}.`, accent: true })
    return segments
  }
  if (dueInDays !== null) {
    segments.push({
      text: dueInDays < 0
        ? `Due ${Math.abs(dueInDays)} ${plural(Math.abs(dueInDays), 'day', 'days')} ago.`
        : dueInDays === 0 ? 'Due today.' : `Due in ${dueInDays} ${plural(dueInDays, 'day', 'days')}.`,
      accent: true,
    })
    return segments
  }
  segments.push({ text: 'Nothing is waiting on you.', accent: true })
  return segments
}
