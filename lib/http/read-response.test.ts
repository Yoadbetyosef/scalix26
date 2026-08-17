import { describe, expect, it } from 'vitest'
import { readJson, type HttpError } from './read-response'

// The point of every case below is the same: a response we did not write must produce a sentence, not
// a parse error. The failing example was real — a 6 MB invoice, refused by the edge, shown to the owner
// as `Unexpected token 'R', "Request En"... is not valid JSON`.

const res = (status: number, body: string, ok?: boolean) =>
  ({ ok: ok ?? (status >= 200 && status < 300), status, text: async () => body }) as unknown as Response

describe('readJson — bodies that are not ours', () => {
  it('turns the edge 413 into a sentence naming the limit and the next step', async () => {
    await expect(readJson(res(413, 'Request Entity Too Large'), 'Could not read that invoice.'))
      .rejects.toThrow(/too large to upload.*limit is 4 MB.*split the document/i)
  })

  it('never leaks a JSON parse error, whatever the body is', async () => {
    for (const body of ['Request Entity Too Large', '<html>504 Gateway Timeout</html>', '', 'null', '[1,2]']) {
      await expect(readJson(res(500, body), 'Could not do that.'))
        .rejects.toThrow(/^(?!.*(Unexpected token|not valid JSON|JSON\.parse)).*$/)
    }
  })

  it('explains an expired session rather than reporting the redirect', async () => {
    // Middleware answers a signed-out request with a 307 to /login. The old code read the HTML body as
    // JSON and threw; before that it surfaced as an empty result, which is the same bug wearing a hat.
    await expect(readJson(res(307, '<html>Redirecting...</html>'), 'x'))
      .rejects.toThrow(/session has expired.*sign in again/i)
  })

  it('has a sentence for each shape the platform can answer with', async () => {
    const cases: Array<[number, RegExp]> = [
      [401, /session has expired/i],
      [403, /do not have permission/i],
      [429, /too many requests/i],
      [502, /could not complete/i],
      [503, /could not complete/i],
      [504, /took too long/i],
    ]
    for (const [status, expected] of cases) {
      await expect(readJson(res(status, 'nope'), 'fallback')).rejects.toThrow(expected)
    }
  })

  it('falls back to the caller’s own sentence for a status it has nothing better for', async () => {
    await expect(readJson(res(418, 'teapot'), 'Could not read that invoice.'))
      .rejects.toThrow('Could not read that invoice.')
  })

  it('treats a 200 that is not JSON as a failure, not as data', async () => {
    // A rewrite or a cached HTML shell answering 200 must never reach the UI as a parsed object.
    await expect(readJson(res(200, '<html>hello</html>'), 'Could not load that.'))
      .rejects.toThrow('Could not load that.')
  })
})

describe('readJson — bodies that ARE ours', () => {
  it('prefers our handler’s own message over the generic one', async () => {
    // The route knows which guard refused and why; this function cannot.
    await expect(readJson(res(400, JSON.stringify({ error: 'Enter the exchange rate you paid.' })), 'generic'))
      .rejects.toThrow('Enter the exchange rate you paid.')
  })

  it('uses the generic sentence when our own body carried no message', async () => {
    await expect(readJson(res(413, JSON.stringify({ error: '' })), 'generic'))
      .rejects.toThrow(/too large to upload/i)
  })

  it('returns the parsed body on success', async () => {
    expect(await readJson<{ shipmentId: string }>(res(200, JSON.stringify({ shipmentId: 'abc' })), 'x'))
      .toEqual({ shipmentId: 'abc' })
  })

  it('carries status and body so a caller can branch on shape, not on message text', async () => {
    // The divergence 409 depends on this: it must reload and ask rather than report a failure.
    try {
      await readJson(res(409, JSON.stringify({ error: 'Margins move.', needsAcknowledgement: true, divergences: [] })), 'x')
      throw new Error('should have thrown')
    } catch (e) {
      const h = e as HttpError
      expect(h.status).toBe(409)
      expect(h.body?.needsAcknowledgement).toBe(true)
      expect(h.message).toBe('Margins move.')
    }
  })
})
