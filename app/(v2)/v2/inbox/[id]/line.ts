import type { RudiSegment } from '../../rudi-line'

export interface ConversationLineInput {
  who: string
  messages: number
  handledByAi: boolean
  takenOver: boolean
  lastFrom: 'them' | 'us' | null
  lastAgo: string | null
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// What an owner needs in one sentence: how much was said, and whether the ball is in their court. The
// accent is whichever of those two is actionable — an unanswered customer first, then a handover.
export function conversationLine({ who, messages, handledByAi, takenOver, lastFrom, lastAgo }: ConversationLineInput): RudiSegment[] {
  if (messages === 0) return [{ text: `Nothing has been said to ${who} yet.`, accent: true }]

  const segments: RudiSegment[] = [
    { text: `${messages} ${plural(messages, 'message', 'messages')} with ${who}${handledByAi && !takenOver ? ', handled by Rudi' : ''}. ` },
  ]

  if (takenOver) {
    segments.push({ text: 'You have taken this one over.', accent: true })
    return segments
  }
  if (lastFrom === 'them') {
    segments.push({ text: `They spoke last${lastAgo ? `, ${lastAgo.toLowerCase()}` : ''}.`, accent: true })
    return segments
  }
  segments.push({ text: 'Nothing is waiting on you.', accent: true })
  return segments
}
