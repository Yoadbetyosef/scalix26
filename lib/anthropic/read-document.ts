import { anthropic } from './client'
import { trackLlm } from '@/lib/cost/track'

// READING A DOCUMENT INTO A SHAPE. One call, for every caller that has bytes and wants fields.
//
// Extracted from lib/invoices/extract.ts when a second reader arrived — receipts. What differs
// between the two is a SCHEMA and a PROMPT. What does not differ is any of the machinery below, and
// the machinery is where the failures live: a document turn assembled in the wrong order, base64 with
// newlines in it, a non-streamed call that times out on a long answer, a text block found by index
// instead of by type, spend that lands on nobody's meter. A second copy of that would be a second
// place for each of those to be got wrong, and the copy that goes wrong is the one written later by
// somebody who assumed the first one was simple.
//
// ── WHY THE DOCUMENT GOES TO THE MODEL WHOLE ────────────────────────────────────────────────────
//
// pdf-parse is already a dependency and could turn a PDF into a string, but an invoice's meaning is
// in its COLUMN LAYOUT: which number is a unit price, which is a line total, which is the freight
// line at the bottom. Flattening the table to a text stream destroys exactly the association the
// extraction depends on, and no prompt recovers it afterwards. The document goes as a document.
//
// This file uses no PDF library at all. lib/invoices/extract.ts briefly used pdf-parse to count
// pages, which broke the whole upload path on Vercel — see pageCountOf there for that story.

/** What the model actually costs and where it landed, alongside the answer. */
export interface DocumentRead<T> {
  value: T
  model: string
  inputTokens: number
  outputTokens: number
  completionId: string
}

/** The image types the API takes as an image block. Anything else has to be a PDF. */
type ImageMedia = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface ReadDocumentOptions {
  /**
   * Only so the spend lands on the right meter — nothing here reads the database. The caller has
   * already resolved and authorised it.
   */
  tenantId: string
  bytes: Buffer
  mimeType: string
  /**
   * A JSON Schema the response is CONSTRAINED to, not asked for. There is no parse step that can
   * fail at midnight and no retry loop around a regex; numbers arrive as numbers.
   */
  schema: Record<string, unknown>
  prompt: string
  model: string
  /**
   * How hard to think before answering. Transcription off a page is not deliberation — see each
   * caller for why it picked what it picked.
   */
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  maxTokens?: number
  /** Named in the error a person sees when the model returns nothing. "invoice", "receipt". */
  subject?: string
}

/**
 * Read one document into `T`.
 *
 * Throws only for things that are wrong with the SOFTWARE — an empty response, a body that will not
 * parse against a schema the API guaranteed. Nothing a particular document can do to itself throws
 * here; a page the model cannot read comes back as nulls in `T`, which is the caller's business.
 */
export async function readDocument<T>({
  tenantId, bytes, mimeType, schema, prompt, model, effort, maxTokens = 16000, subject = 'document',
}: ReadDocumentOptions): Promise<DocumentRead<T>> {
  // base64 with no newlines, and the document BEFORE the instruction — both are how the API expects a
  // document turn to be shaped.
  const data = bytes.toString('base64')
  const source = { type: 'base64' as const, media_type: mimeType, data }
  const documentBlock = mimeType === 'application/pdf'
    ? { type: 'document' as const, source: { ...source, media_type: 'application/pdf' as const } }
    : { type: 'image' as const, source: source as { type: 'base64'; media_type: ImageMedia; data: string } }

  // Streamed: a long document's structured output can run past the point where a non-streaming
  // request risks an SDK HTTP timeout, and the failure mode there is a lost extraction the owner
  // already paid for.
  const stream = anthropic.messages.stream({
    model,
    max_tokens: maxTokens,
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: [documentBlock, { type: 'text', text: prompt }] }],
  } as Parameters<typeof anthropic.messages.stream>[0])

  const message = await stream.finalMessage()

  // Metered the moment it is known, with the real completion id as resourceId so the usage_events row
  // is deterministic and deduped rather than a fresh uuid per attempt.
  trackLlm(tenantId, model, message.usage, { resourceId: message.id })

  // Narrowed structurally rather than with a type predicate: `content` is a union whose other members
  // have no `text`, and asserting a shape that isn't assignable to ContentBlock is how you get a cast
  // that compiles and lies. `in` narrows without claiming anything the SDK hasn't declared.
  const block = message.content.find((b) => b.type === 'text')
  const text = block && 'text' in block ? block.text : null
  if (!text) throw new Error(`The model returned no content for this ${subject}.`)

  // Guaranteed to parse and to match the schema — that is what output_config.format buys. A throw here
  // means something changed about the API, not about this document, and it should read that way.
  return {
    value: JSON.parse(text) as T,
    model,
    inputTokens: message.usage.input_tokens ?? 0,
    outputTokens: message.usage.output_tokens ?? 0,
    completionId: message.id,
  }
}

/**
 * Nullable as `anyOf`, not `type: [..., 'null']`.
 *
 * The supported subset of JSON Schema is narrow and anyOf is in it. Here rather than in each schema
 * because every reader needs it — a field that cannot say "absent" is a field that will say 0.
 */
export const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] })
