import type { RudiSegment } from './rudi-line'

// Her reply, split so the gradient marks ONE clause: the part that needs the owner's answer or their
// action. Everything else stays white.
//
// Both previous versions were wrong in the same way — they treated the gradient as a text colour. All
// gradient loses the sentence's middle over a mid-tone portrait; all white says nothing about which
// part matters. It is emphasis, so it has to fall on something, and at most one thing.
//
// Same shape as rudi-line.ts: a pure function returning segments, so <b> renders as an element and
// nothing is dangerously set. It reads her words and never rewrites them — every character of the
// input appears in the output, in order.
//
// Most replies ask nothing. All white is the correct and common result, and that is not a failure to
// find something.

/** A clause that asks the owner something, in the forms an assistant actually uses. */
const ASKS: RegExp[] = [
  // Offers: "Want me to…", "Should I…", "Shall I…", "Would you like…", "Do you want…"
  /\b(want me to|should i|shall i|would you like|do you want|can i)\b/i,
  // Instructions and hand-backs: "Let me know…", "Just say…", "You'll need to…", "Tell me…"
  /\b(let me know|just say|say the word|you'?ll need to|you can|tell me|give me)\b/i,
]

/** A clause that resolves: nothing is being asked, and saying so IS the point of the sentence. */
const RESOLVES: RegExp[] = [
  /\bnothing (needs|requires) (you|your)\b/i,
  /\byou'?re (all )?(set|clear|covered|good)\b/i,
  /\ball (caught up|clear|done)\b/i,
]

/**
 * Split on sentence and clause boundaries, KEEPING the delimiter and the space that follows it, so
 * joining the pieces reproduces the input exactly.
 */
function clauses(text: string): string[] {
  const out: string[] = []
  let buf = ''
  for (let i = 0; i < text.length; i++) {
    buf += text[i]
    const isBreak = /[.!?]/.test(text[i]) || text[i] === ','
    const next = text[i + 1]
    // A break only ends a clause when whitespace or the end of the string follows it — otherwise it is
    // a decimal point, an abbreviation, or a comma inside a number.
    if (isBreak && (next === undefined || /\s/.test(next))) {
      while (text[i + 1] !== undefined && /\s/.test(text[i + 1])) { buf += text[i + 1]; i++ }
      out.push(buf)
      buf = ''
    }
  }
  if (buf) out.push(buf)
  return out
}

const matches = (c: string, res: RegExp[]) => res.some((r) => r.test(c))

export function replyLine(reply: string): RudiSegment[] {
  const text = (reply ?? '').trim()
  if (!text) return []

  const parts = clauses(text)
  if (parts.length === 0) return []

  // Which clause carries the emphasis, searched from the END: when a reply reports and then asks, the
  // ask is last, and it is the part the owner acts on.
  let idx = -1
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].trimEnd().endsWith('?')) { idx = i; break }
  }
  if (idx === -1) for (let i = parts.length - 1; i >= 0; i--) {
    if (matches(parts[i], ASKS)) { idx = i; break }
  }
  if (idx === -1) for (let i = parts.length - 1; i >= 0; i--) {
    if (matches(parts[i], RESOLVES)) { idx = i; break }
  }

  // Nothing asks anything. All white, which is the common case and the right answer.
  if (idx === -1) return [{ text }]

  // A single clause that is itself the ask would mean accenting the whole reply, which is the thing
  // this function exists to prevent. Emphasis needs something to contrast with.
  if (parts.length === 1) return [{ text }]

  const before = parts.slice(0, idx).join('')
  const accent = parts[idx]
  const after = parts.slice(idx + 1).join('')

  const segments: RudiSegment[] = []
  if (before) segments.push({ text: before })
  // Trailing whitespace moves out of the accent, so the gradient does not paint empty space.
  segments.push({ text: accent.trimEnd(), accent: true })
  const tail = accent.slice(accent.trimEnd().length) + after
  if (tail) segments.push({ text: tail })
  return segments
}
