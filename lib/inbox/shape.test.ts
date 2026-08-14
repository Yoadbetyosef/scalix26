import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { CONV_COLS, CONTACT_COLS, AGENT_COLS, MESSAGE_COLS } from './conversation-read'

// THE FOURTH INVENTED FIELD STOPS HERE.
//
// `meta_page_name`, `subscription_status`, a previous-month comparison — those three the compiler
// caught, because they were read off typed rows. These three were not: `direction` and `status` on a
// message, and `persona` on the joined employee. What made them different was `select('*')` paired
// with a `Record<string, unknown> &` type — postgrest returned whatever existed, the index signature
// accepted any key, and tsc had no list of names to check against.
//
// The columns are named constants now, the row types are exact, and this asserts the two agree. A
// field a screen reads must be a field the query asked for; a name that is not a column fails at the
// query rather than being quietly undefined.

const src = readFileSync(new URL('./conversation-read.ts', import.meta.url), 'utf8')
// The file explains the fault it fixed, and that explanation names the shapes it no longer uses.
// Scanning the prose would fail the very check the prose documents.
const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

/** The field names a TypeScript interface declares, in source order. */
function declared(iface: string): string[] {
  const body = src.slice(src.indexOf(`export interface ${iface} {`))
  const inner = body.slice(body.indexOf('{') + 1, body.indexOf('\n}'))
  return [...inner.matchAll(/^\s{2}(\w+)[?]?:/gm)].map((m) => m[1])
}

const cols = (list: string) => list.split(',').map((c) => c.trim())

describe('every declared field is a column the query asks for', () => {
  it('the conversation', () => {
    // contact and ai_employee are joins, named separately below.
    const fields = declared('ConversationRow').filter((f) => f !== 'contact' && f !== 'ai_employee')
    for (const f of fields) expect(cols(CONV_COLS)).toContain(f)
  })

  it('the contact', () => {
    const inner = src.slice(src.indexOf('contact: {'), src.indexOf('} | null', src.indexOf('contact: {')))
    for (const f of [...inner.matchAll(/(\w+):/g)].map((m) => m[1]).filter((f) => f !== 'contact')) {
      expect(cols(CONTACT_COLS)).toContain(f)
    }
  })

  it('the employee — including persona, which the thread paints from', () => {
    expect(cols(AGENT_COLS)).toEqual(['name', 'persona'])
  })

  it('the message', () => {
    for (const f of declared('MessageRow')) expect(cols(MESSAGE_COLS)).toContain(f)
  })
})

describe('the two fields that never existed', () => {
  it('no message carries a `direction`', () => {
    // The real column is `role`. `direction` was declared, never returned, and every comparison
    // against it was false — so every customer message rendered on the agent's side.
    expect(code).not.toMatch(/\bdirection\b\s*:/)
    expect(cols(MESSAGE_COLS)).toContain('role')
  })

  it('no message carries a bare `status`', () => {
    // The real column is `delivery_status`, and it is null until a provider callback resolves it.
    expect(cols(MESSAGE_COLS)).toContain('delivery_status')
    expect(cols(MESSAGE_COLS)).not.toContain('status')
  })

  it('and nothing here selects a star', () => {
    expect(code).not.toMatch(/\.select\('\*'\)|select\('\*,/)
  })

  it('nor keeps an index signature that would absorb the next one', () => {
    expect(code).not.toContain('Record<string, unknown> &')
  })
})

describe('the screen reads what the row carries', () => {
  const body = readFileSync(new URL('../../app/(v2)/v2/inbox/[id]/body.tsx', import.meta.url), 'utf8')

  it('authorship comes from role, per message', () => {
    expect(body).toContain("by: m.role === 'user' ? 'customer' : m.role === 'agent' ? 'you' : 'agent'")
  })

  it('and not from the conversation, which would relabel the past', () => {
    // conv.human_takeover is per CONVERSATION: taking a thread over would have relabelled every
    // reply the employee had already sent as the owner's own.
    const map = body.slice(body.indexOf('const lines:'), body.indexOf('}))', body.indexOf('const lines:')))
    expect(map).not.toContain('human_takeover')
  })

  it('a failure is delivery_status, not status', () => {
    expect(body).toContain("failed: m.delivery_status === 'failed' || m.delivery_status === 'undelivered'")
  })
})
