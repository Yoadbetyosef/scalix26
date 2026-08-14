// IS THERE AN ANSWER TO THIS ON FILE?
//
// The autonomy rule's fourth line is "anything with no answer in the knowledge base", and
// `classifyReply` deliberately refuses to guess it — `grounded` has no default. This is where the
// caller works it out.
//
// ── WHY IT READS THE QUESTION AND NOT THE REPLY ─────────────────────────────────────────────────────
//
// A model will answer anything, fluently, whether or not the business ever told us. Checking the
// REPLY against the knowledge base would mostly measure how well the model paraphrases. The honest
// question is the customer's: did they ask about something this business has written down? If the
// terms they used appear nowhere in the knowledge base, the catalog, the hours or the business's own
// details, then whatever came back was improvised, and improvisation is exactly what the rule holds.
//
// Deterministic and cheap. It runs on every inbound message, and it has to be explainable to an owner
// who asks why their reply was held.

/** Words that carry no topic. A question is mostly these; what remains is what it is about. */
const STOP = new Set([
  'a', 'about', 'after', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'before',
  'but', 'by', 'can', 'could', 'did', 'do', 'does', 'doing', 'for', 'from', 'get', 'got', 'had',
  'has', 'have', 'hey', 'hi', 'hello', 'how', 'i', 'if', 'in', 'is', 'it', 'its', 'just', 'know',
  'like', 'me', 'much', 'my', 'need', 'no', 'not', 'of', 'on', 'once', 'one', 'or', 'our', 'out',
  'please', 'so', 'some', 'thanks', 'thank', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'to', 'up', 'want', 'was', 'we', 'were', 'what', 'when', 'where',
  'which', 'who', 'will', 'with', 'would', 'you', 'your', 'yours',
  // Spanish
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'y', 'o', 'que', 'es', 'por', 'para', 'con', 'como',
  'cuando', 'donde', 'hola', 'gracias', 'necesito', 'quiero',
])

/** Content words, lowercased, de-duplicated, short ones dropped. */
export function terms(text: string): string[] {
  const words = (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
  return [...new Set(words)]
}

export interface GroundingSources {
  /** knowledge_base entries — title and content, already scoped to this agent. */
  knowledge: string[]
  /** Catalog names, service names: what the business sells. */
  catalog?: string[]
  /** The business's own details — hours, address, phone. Answers "where are you", "when do you open". */
  facts?: string[]
}

export interface Grounding {
  grounded: boolean
  /** The question's content words that appear nowhere on file. Shown to nobody yet; useful in a log. */
  missing: string[]
  /** How much of the question is covered, 0..1. */
  coverage: number
}

/**
 * Half the question's content words have to appear somewhere on file.
 *
 * Not all of them: a customer asking "how much is a gold chain repair" uses words no knowledge base
 * indexes ("much"), and demanding a total match would hold every message. Not one of them either:
 * a single incidental overlap would clear anything. Half is the line, and it is a line rather than a
 * judgement so that the same message always gets the same answer.
 *
 * A question with no content words at all ("hi there?") is NOT grounded — there is nothing to answer,
 * and a reply to it is by definition improvised.
 */
export function groundedFor(question: string, sources: GroundingSources): Grounding {
  const asked = terms(question)
  if (asked.length === 0) return { grounded: false, missing: [], coverage: 0 }

  const corpus = new Set(
    [...(sources.knowledge ?? []), ...(sources.catalog ?? []), ...(sources.facts ?? [])].flatMap(terms),
  )
  if (corpus.size === 0) return { grounded: false, missing: asked, coverage: 0 }

  const missing = asked.filter((t) => !corpus.has(t))
  const coverage = (asked.length - missing.length) / asked.length
  return { grounded: coverage >= 0.5, missing, coverage }
}
