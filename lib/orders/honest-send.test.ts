import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// An action must not report success for a delivery that did not happen.
//
// `sendEmail()` RETURNS { success: false } on a provider error — it does not throw (lib/email/send.ts).
// So `try { await sendEmail(...) } catch {}` is dead code for email: the catch cannot fire, and whatever
// follows runs as though the message left. Every site below is one where a person is shown a claim, so
// each has to read the returned result.
//
// This is a static test on purpose. The bug it guards is a MISSING check, and a missing check is visible
// in the source without standing up Supabase, Resend and a session.

const root = process.cwd()
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

describe('actions that tell someone a message was sent must check that it was', () => {
  // file → the call whose result must be consumed.
  const SITES: Array<[string, RegExp]> = [
    // Moving an order to Production: emails the factory a fresh delivery link.
    ['lib/orders/approvals.ts', /sent = await sendEmail\(/],
    // The customer's estimate/quote/invoice link.
    ['lib/orders/shares.ts', /const sent = await sendEmail\(/],
    // The approval request that advances the order's stage.
    ['lib/orders/approvals.ts', /const sendResult = await sendEmail\(/],
    // Studio document → client or supplier.
    ['app/api/studio/documents/[id]/send/route.ts', /const sent = await sendEmail\(/],
    // Partner demo share — the response lists which channels went out.
    ['app/api/partner/demos/[id]/send/route.ts', /\(await sendEmail\([\s\S]*?\)\)\.success/],
    // Teammate invitation.
    ['app/api/partner/members/route.ts', /\(await sendEmail\([\s\S]*?\)\)\.success/],
    // The payment link the agent then claims to have emailed.
    ['lib/stripe/payment-collection.ts', /emailed = \(await sendEmail\(/],
  ]

  it.each(SITES)('%s consumes the sendEmail result', (file, pattern) => {
    expect(code(file)).toMatch(pattern)
  })

  it.each(SITES)('%s never treats sendEmail as throwing', (file) => {
    // `await sendEmail(...)` on its own line, with the value dropped, is the shape of the bug.
    const bare = code(file).split('\n').filter((l) => /^\s*await sendEmail\(/.test(l))
    expect(bare, `dropped sendEmail result in ${file}: ${bare.join(' | ')}`).toEqual([])
  })
})

describe('moving an order to production reports who was notified', () => {
  const src = code('lib/orders/approvals.ts')

  it('returns a notified address rather than a bare ok', () => {
    // It used to return { ok: true } whether or not anything was sent, and the caller had no way to know.
    expect(src).toMatch(/notified: string \| null/)
    expect(src).toMatch(/reason: 'no_factory_approval' \| 'send_failed' \| null/)
    // Every exit from the happy path states an outcome.
    expect(src).toMatch(/return \{ ok: true, notified: null, reason: 'no_factory_approval' \}/)
    expect(src).toMatch(/return \{ ok: true, notified: null, reason: 'send_failed'/)
    expect(src).toMatch(/return \{ ok: true, notified: recipient, reason: null \}/)
  })

  it('logs delivery_requested only on a successful send', () => {
    // The event that means "the factory has been told" must sit after the success check, not beside the
    // stage change.
    const requested = src.indexOf("type: 'delivery_requested'")
    const guard = src.indexOf('if (!sent.success)')
    expect(requested).toBeGreaterThan(-1)
    expect(guard).toBeGreaterThan(-1)
    expect(requested).toBeGreaterThan(guard)
  })

  it('no longer writes the sent_to_production event', () => {
    // The name asserted a send. New rows say moved_to_production; the old name survives only as a label
    // for rows already in the table.
    expect(src).not.toMatch(/type: 'sent_to_production'/)
    expect(src).toMatch(/type: 'moved_to_production'/)
    expect(code('app/orders/[id]/page.tsx')).toMatch(/sent_to_production: 'Moved to production'/)
  })
})

describe('the button does not promise what the action cannot do', () => {
  const ui = code('components/orders/approval-actions.tsx')

  it('is labelled for the stage move, which always happens', () => {
    expect(ui).toMatch(/>Move to Production</)
    expect(ui).not.toMatch(/>Send to Production</)
  })

  it('cannot send a work order without a factory to send it to', () => {
    // The send button is disabled until a supplier with an address is chosen. Nothing about this action
    // types an address: it is picked from the record, or the record is created first.
    expect(ui).toMatch(/disabled=\{busy \|\| !supplier\?\.email\}/)
    expect(ui).toMatch(/'Send work order & move'/)
  })

  it('offers moving without notifying as its own labelled choice', () => {
    // Legitimate — she may have phoned them. It must never be reachable by pressing the send button and
    // hoping, so it says exactly what it does.
    expect(ui).toMatch(/>Move without notifying anyone</)
    expect(ui).toMatch(/toProduction\(null\)/)
  })

  it('states the outcome afterwards, including having notified nobody', () => {
    expect(ui).toMatch(/Nobody has been told/)
    expect(ui).toMatch(/was emailed at \$\{j\.notified\}/)
  })
})

describe('a factory send is addressed to a record, not to typing', () => {
  const lib = code('lib/orders/approvals.ts')
  const ui = code('components/orders/approval-actions.tsx')

  it('refuses a factory approval with no supplier chosen', () => {
    expect(lib).toMatch(/if \(!input\.supplierId\) return \{ ok: false, error: 'Choose the factory this is going to\.' \}/)
  })

  it('takes the address from the supplier rather than the form', () => {
    // Retyping is what produced four spellings of one workshop, and an order whose factory was a
    // single character.
    expect(lib).toMatch(/recipientEmail: supplier\.email/)
    expect(ui).not.toMatch(/open === 'factory'[^\n]*recipientEmail: f\.recipientEmail/)
  })

  it('records the supplier on the order only after the send succeeded', () => {
    // An order must never name a factory that was never contacted.
    const stamp = lib.indexOf('supplier_id: supplier.id }')
    const guard = lib.indexOf('if (!sendResult.success)')
    expect(stamp).toBeGreaterThan(guard)
  })

  it('moving to production can send a work order with no prior approval', () => {
    // The cold path: no factory request exists, so one is created at status sent — not approved, because
    // nobody approved anything.
    expect(lib).toMatch(/approval_type: 'factory', supplier_id: supplier!\.id/)
    expect(lib).toMatch(/status: 'sent', version: 1/)
    expect(lib).toMatch(/const firstContact = !fr/)
  })

  it('keeps the work order on the spec-only approval page', () => {
    // The factory page carries stones, shapes, metal, ring size and photographs and no money at all.
    // Pointing a work order at the customer document body would show them the retail price.
    expect(lib).toMatch(/\$\{baseUrl\}\/approval\/\$\{token\}/)
    expect(lib).not.toMatch(/\/e\/\$\{token\}/)
  })
})
