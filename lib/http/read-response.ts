// Reading a fetch() response without assuming it is ours.
//
// ── THE BUG THIS EXISTS FOR ─────────────────────────────────────────────────────────────────────────
//
// Every caller in this app was written as:
//
//     const r = await fetch(url, …)
//     const d = await r.json()            // <- assumes a JSON body
//     if (!r.ok) throw new Error(d.error)
//
// That handles exactly one shape — a response our own route produced — and lets every other shape
// surface as noise. A 6 MB invoice upload came back from Vercel's edge as the plain text "Request
// Entity Too Large", `r.json()` threw before line 3 ever ran, and the owner was shown:
//
//     Unexpected token 'R', "Request En"... is not valid JSON
//
// which names none of: the file, its size, the limit, or what to do. The same class as a middleware
// 307 swallowed as an empty result: we parse the success shape and call everything else an error we
// then fail to read.
//
// ── THE RESPONSES THAT ARE NOT OURS ─────────────────────────────────────────────────────────────────
//
// They are not exotic. In order of how often a real tenant will meet them:
//
//   413  edge, before routing — body over MAX_REQUEST_BODY_BYTES. Plain text.
//   307  middleware redirect — an expired session on a route that needs one. HTML.
//   504  the function exceeded its duration. HTML.
//   502  the function crashed before it could answer. HTML.
//   429  rate limited upstream of the handler. Sometimes JSON, sometimes not.
//
// None of these are reachable from inside the handler, so none can be made to return our JSON shape.
// The only place they can be turned into a sentence is here.

import { MAX_INVOICE_BYTES } from '@/lib/orders/attachment-types'

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`

/**
 * A sentence for a response that did not come from one of our handlers.
 *
 * Written for the person holding the file, not the person reading the logs: what went wrong, and the
 * next thing to do. No status codes, no "unexpected", no apology.
 */
function sentenceFor(status: number, fallback: string): string {
  if (status === 413) {
    return `That file is too large to upload. The limit is ${mb(MAX_INVOICE_BYTES)} — split the document or save it at a smaller size and try again.`
  }
  if (status === 401 || status === 307 || status === 302) {
    return 'Your session has expired. Refresh the page and sign in again, then try that once more.'
  }
  if (status === 403) return 'You do not have permission to do that.'
  if (status === 429) return 'Too many requests just now. Wait a moment and try again.'
  if (status === 504) return 'That took too long and was cut off. If it is a large file, try a smaller one.'
  if (status === 502 || status === 503) return 'The server could not complete that. Try again in a moment.'
  return fallback
}

/**
 * Parse a response body as JSON, or return null — never throw.
 *
 * `r.json()` on an empty body throws too, which is why a 204 and a 500-with-HTML need the same care.
 */
async function bodyOf(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const text = await res.text()
    if (!text) return null
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * The response body on success; a thrown Error carrying a plain sentence otherwise.
 *
 * Deliberately throws rather than returning a result union: every call site already sits in a
 * try/catch that ends `setErr((e as Error).message)`, so this drops in without restructuring them,
 * and a site that forgets to check cannot silently proceed on an error body.
 *
 * `fallback` is what to say when the failure IS ours and carried no message — keep it specific to the
 * action ("Could not read that invoice"), because it is the sentence a tenant sees most often.
 */
export async function readJson<T = Record<string, unknown>>(res: Response, fallback: string): Promise<T> {
  const body = await bodyOf(res)

  if (!res.ok) {
    // Our own handlers answer with { error }. Prefer it — it was written for this exact situation and
    // knows things this function cannot, like which guard refused and why.
    const ours = typeof body?.error === 'string' && body.error ? body.error : null
    const err = new Error(ours || sentenceFor(res.status, fallback))
    // Carried so a caller can branch on the shape it expects (the divergence 409 does) while every
    // other caller keeps treating this as an ordinary Error.
    Object.assign(err, { status: res.status, body })
    throw err
  }

  // A 2xx that is not JSON is still not something to hand to the UI as data.
  if (body === null) throw new Error(fallback)
  return body as T
}

/** The extra fields readJson attaches, for the callers that branch on them. */
export interface HttpError extends Error {
  status?: number
  body?: Record<string, unknown> | null
}
